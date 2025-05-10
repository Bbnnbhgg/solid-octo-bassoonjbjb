// GitHub settings (set GITHUB_TOKEN in Cloudflare environment variables)
const GITHUB_TOKEN = ENV_GITHUB_TOKEN;
const REPO_OWNER = "hiplitewhat";
const REPO_NAME = "notes-app";
const USER_AGENT = "notes-app-worker";

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

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    return new Response(HTML_PAGE, { headers: { "Content-Type": "text/html" } });
  }

  if (url.pathname === "/notes" && request.method === "GET") {
    const notes = await fetchNotesFromGitHub();
    return new Response(JSON.stringify(notes), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (url.pathname === "/notes" && request.method === "POST") {
    const requestBody = await request.json();
    const { title, content } = requestBody;
    if (!title || !content) {
      return new Response(JSON.stringify({ message: "Title and Content are required." }), { status: 400 });
    }

    // Call profanity filter API
    const filteredContent = await filterContent(content);

    let obfuscatedContent = filteredContent;
    if (isRobloxScript(filteredContent)) {
      try {
        const response = await fetch("https://comfortable-starfish-46.deno.dev/obfuscate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script: filteredContent }),
        });
        if (response.ok) {
          const data = await response.json();
          if (typeof data.obfuscated === "string" && data.obfuscated.trim() !== "") {
            obfuscatedContent = data.obfuscated;
          }
        }
      } catch (err) {
        console.warn("Obfuscation API failed:", err.message);
      }
    }

    const noteId = generateUUID();
    console.log(`Storing note ID: ${noteId}`);
    await storeNoteInGitHub(noteId, title, obfuscatedContent);

    return new Response(JSON.stringify({ id: noteId, title, content: obfuscatedContent }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  }

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

  if (url.pathname.startsWith("/notes/raw/") && request.method === "GET") {
    const userAgent = (request.headers.get("User-Agent") || "").toLowerCase();
    if (!userAgent.startsWith("roblox")) {
      return new Response("Access denied. hnotes.", {
        status: 403,
        headers: { "Content-Type": "text/plain" }
      });
    }

    const noteId = url.pathname.split("/")[3];
    console.log("Requested raw note ID:", noteId);

    const note = await fetchNoteFromGitHub(noteId);
    if (!note) {
      console.warn(`Note with ID '${noteId}' not found in GitHub.`);
      return new Response(`Raw note not found.\nMake sure the note ID is correct and the file exists in GitHub as notes/${noteId}.json.`, {
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

// Function to call the profanity filter API
async function filterContent(content) {
  const filterApiUrl = "https://super-feather-4931.hiplitehehe.workers.dev/filter";  // Replace with your filter URL
  const response = await fetch(filterApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: content })
  });

  if (!response.ok) {
    throw new Error("Failed to filter content.");
  }

  const data = await response.json();
  return data.filtered;  // Returning the filtered content
}

function isRobloxScript(content) {
  return content.includes("game") || content.includes("script");
}

function generateUUID() {
  return crypto.randomUUID();
}

async function storeNoteInGitHub(noteId, title, content) {
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

async function fetchNotesFromGitHub() {
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
  const notes = [];

  for (const file of files) {
    if (file.type === "file" && file.name.endsWith(".json")) {
      const content = await fetch(file.download_url).then(res => res.json());
      notes.push({ id: file.name.split(".")[0], title: content.title, content: content.content });
    }
  }

  return notes;
}

async function fetchNoteFromGitHub(noteId) {
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

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
