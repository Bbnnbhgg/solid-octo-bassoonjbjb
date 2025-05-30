const GITHUB_TOKEN = ENV_GITHUB_TOKEN;
const REPO_OWNER = "hiplitewhat";
const REPO_NAME = "notes-app";
const USER_AGENT = "notes-app-worker";

// Gemini API settings
const GEMINI_API_KEY = ENV_GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// HTML content as a string (for the main page)
const HTML_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notes App</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    input, button, textarea { margin: 5px 0; width: 100%; }
    .note { padding: 10px; background-color: #f4f4f4; margin-bottom: 10px; }
  </style>
</head>
<body>
  <h1>Notes App</h1>
  <form id="noteForm">
    <input type="text" id="title" placeholder="Note Title" required /><br>
    <textarea id="content" rows="4" placeholder="Write your note here..." required></textarea><br>
    <button type="submit">Create Note</button>
  </form>
  <h2>All Notes</h2>
  <div id="notesContainer"></div>
  <script>
    document.getElementById('noteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('title').value;
      const content = document.getElementById('content').value;
      const response = await fetch('/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content })
      });
      if (response.ok) {
        document.getElementById('title').value = '';
        document.getElementById('content').value = '';
        fetchNotes();
      } else {
        alert('Failed to create note');
      }
    });

    async function fetchNotes() {
      const response = await fetch('/notes');
      const notes = await response.json();
      const notesContainer = document.getElementById('notesContainer');
      notesContainer.innerHTML = '';
      notes.forEach((note) => {
        const div = document.createElement('div');
        div.classList.add('note');
        const noteLink = document.createElement('a');
        noteLink.href = '/notes/' + note.id;
        noteLink.textContent = note.title;
        div.appendChild(noteLink);
        const rawLink = document.createElement('a');
        rawLink.href = '/notes/raw/' + note.id;
        rawLink.textContent = ' (Raw)';
        div.appendChild(rawLink);
        notesContainer.appendChild(div);
      });
    }

    window.onload = fetchNotes;
  </script>
</body>
</html>
`;

// Function to call the Gemini API for content filtering
async function filterContent(content: string): Promise<string> {
  const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const payload = {
      content: {
        parts: [{ text: content }]
      }
    };

    const response = await fetch(geminiApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to filter content using Gemini:", errorText);
      throw new Error(`Failed to filter content using Gemini. Response: ${errorText}`);
    }

    const data = await response.json();
    return data.filteredContent || content;  // Return filtered content or fallback to original if no filter applied
  } catch (error) {
    console.error("Error while filtering content using Gemini:", error.message);
    throw error;
  }
}

// Function to handle incoming requests
async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Serve the main HTML page
  if (url.pathname === "/") {
    return new Response(HTML_PAGE, { headers: { "Content-Type": "text/html" } });
  }

  // Handle GET request to fetch all notes
  if (url.pathname === "/notes" && request.method === "GET") {
    const notes = await fetchNotesFromGitHub();
    return new Response(JSON.stringify(notes), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Handle POST request to create a note
  if (url.pathname === "/notes" && request.method === "POST") {
    const requestBody = await request.json();
    const { title, content } = requestBody;

    if (!title || !content) {
      return new Response(JSON.stringify({ message: "Title and Content are required." }), { status: 400 });
    }

    // Filter both title and content using Gemini
    const filteredTitle = await filterContent(title);
    const filteredContent = await filterContent(content);

    const noteId = generateUUID();
    console.log(`Storing note ID: ${noteId}`);
    await storeNoteInGitHub(noteId, filteredTitle, filteredContent);

    return new Response(JSON.stringify({ id: noteId, title: filteredTitle, content: filteredContent }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Serve the specific note by ID (HTML view)
  if (url.pathname.startsWith("/notes/") && request.method === "GET" && !url.pathname.startsWith("/notes/raw/")) {
    const noteId = url.pathname.split("/")[2];
    const note = await fetchNoteFromGitHub(noteId);
    if (!note) {
      return new Response("Note not found", { status: 404 });
    }
    return new Response(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${note.title}</title>
      </head>
      <body>
        <h1>${note.title}</h1>
        <pre>${note.content}</pre>
      </body>
      </html>
    `, { headers: { "Content-Type": "text/html" } });
  }

  // Serve the raw content of a note
  if (url.pathname.startsWith("/notes/raw/") && request.method === "GET") {
    const noteId = url.pathname.split("/")[3];
    console.log("Requested raw note ID:", noteId);

    const note = await fetchNoteFromGitHub(noteId);
    if (!note) {
      return new Response(`Raw note not found. Make sure the note ID is correct.`, {
        status: 404,
        headers: { "Content-Type": "text/plain" }
      });
    }

    return new Response(note.content, {
      headers: { "Content-Type": "text/plain" }
    });
  }

  return new Response("Not Found", { status: 404 });
}

// Function to generate a UUID
function generateUUID(): string {
  return crypto.randomUUID();
}

// Function to store the note in GitHub
async function storeNoteInGitHub(noteId: string, title: string, content: string): Promise<any> {
  if (!GITHUB_TOKEN) throw new Error("Missing GitHub token");

  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/notes/${noteId}.json`;
  const base64Content = btoa(JSON.stringify({ title, content }));

  const payload = {
    message: `Add new note: ${noteId}`,
    content: base64Content,
    branch: "main"
  };

  const headers = {
    "Authorization": `token ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT
  };

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return await response.json();
}

// Function to fetch all notes from GitHub
async function fetchNotesFromGitHub(): Promise<any[]> {
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/notes`;
  const headers = {
    "Authorization": `token ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": USER_AGENT
  };

  const response = await fetch(apiUrl, { headers });
  if (!response.ok) {
    throw new Error(`GitHub fetch error: ${response.statusText}`);
  }

  const files = await response.json();
  const notes: any[] = [];

  for (const file of files) {
    if (file.type === "file" && file.name.endsWith(".json")) {
      const content = await fetch(file.download_url).then(res => res.json());
      notes.push({ id: file.name.split(".")[0], title: content.title, content: content.content });
    }
  }

  return notes;
}

// Function to fetch a specific note from GitHub
async function fetchNoteFromGitHub(noteId: string): Promise<any | null> {
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/notes/${noteId}.json`;
  const headers = {
    "Authorization": `token ${GITHUB_TOKEN}`,
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": USER_AGENT
  };

  const response = await fetch(apiUrl, { headers });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub fetch error: ${response.statusText}`);

  const file = await response.json();
  const content = await fetch(file.download_url).then(res => res.json());

  return { title: content.title, content: content.content };
}

// Cloudflare Worker event listener
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
