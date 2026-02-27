# 🧠 Obsidian MCP: The AI Assistant That Understands Your Thoughts

**Obsidian MCP** turns your Obsidian notes into a "Giant Map of Thoughts" (Intelligent Knowledge Graph). 
Beyond just reading files, it helps AI understand how your notes are connected, allowing it to find information smarter and faster.

---

## 🌟 What makes it so great? (Even a 5th grader can get it!)

Imagine you wrote lots of notes in a notebook:
- 📖 **Before**: The AI could only see one page at a time if you told it to.
- 🚀 **Now**: The AI thinks, "Hey, since he's talking about 'Lions', I should also look at his notes on 'Savanna' and 'Cats'!"
- 🗺️ **How?**: It looks at your `[[links]]` and `#tags` to build a "Map of your Brain" automatically.

---

## 🛠️ How to Setup (Super Simple!)

### Step 1: Requirements
You need **Node.js 20** or higher installed on your computer.

### Step 2: Install
In your project folder, simply type:
```bash
npm install
```

### Step 3: Connect Your Notes (Environment Variables)
The AI needs to know where your Obsidian Vault is. You just need to tell it two things:

- `OBSIDIAN_VAULT_ROOT`: The **absolute path** to your Obsidian vault folder.
- `MAX_FILE_BYTES` (Optional): Limits the size of files it reads (Default is 256KB).

### Step 4: Run
Type this to start the engine:
```bash
OBSIDIAN_VAULT_ROOT="/path/to/your/vault" npm run dev
```

---

## 🚀 Smart Features

This engine gives the AI special powers:

1.  **Map Building (`graph.build`)**: Scans all your notes to build a map of connections.
2.  **Smart Context Gatherer (`context.gather`)**: When you ask about a topic, it finds related notes, summarizes them, and brings them to the AI.
3.  **Backlink Finder (`graph.get_backlinks`)**: Shows you who else is talking about the current note.
4.  **Neighbor Explorer (`graph.get_neighbors`)**: Explores everything connected to a specific note.
5.  **Basic Tools**: Listing, reading, searching, and getting metadata for notes are all supported!

---

## 🔒 Security & Privacy
- **Read-Only**: It will NEVER change or delete your notes. It only reads them.
- **Local Only**: Your private thoughts stay on your computer. Nothing is sent to external servers.

---

## 📜 License
MIT License. Free for everyone to use and improve!
