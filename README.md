**OpenArchi - An open-source ArchiMate modeling tool built for human & AI collaboration**

OpenArchi is a modern, alternative to Archi. It provides an interactive canvas for visual architecture modeling, backed by the ArchiMate language by The Open Group along with a more agentic friendly layer in Markdown, making them readable and editable by humans and AI agents.

Built with React, Typescript and Vite and designed to be extended with AI agents (Claude, Codex and others) that can reason about, generate and refine architecture models alongside human architect. 

## Background
It all really started when I was working on another project and wanted to work with Archi on Linux. Since it's a community maintained package, there were some bugs and frustrations which led me to thinking - why is this tool still stuck in an older era? I know little about the React/Typescript ecosystem so I rely **a lot** on handholding from Claude, there might be bugs and issues of it's own in this tool! 

## Current limitations
- No-persistent storage: Opening a directory or importing an .archimate file does only allows viewing and editing without persisting the changes.
- No markdown support: No markdown layer for AI agents to read, see roadmap.
- Lack of priority updates: There are some properties of elements not currently loaded by OpenArchi. 
- No true coArchi support: There is no way currently to open a coArchi model and save edits that can later be commited.

## Future features
- Markdown layer that translates ArchiMate for AI agents
- Code view, see either ArchiMate XML or Markdown side-by-side next to current view
- Comparasion view, showing changes that were done previously by others 
- Plan view, AI will create a pop out view with suggested model where you can further apply
- Natural language model generation
- Model versioning
- Multi-user editing sessions
- Model templates

## Quick Start

```bash
git clone <repo-url>
cd openarchi
pnpm install
pnpm dev
```

Opens at `http://localhost:3000`.
