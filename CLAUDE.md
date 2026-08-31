# YouTube Comment AI

## Project

Build a Chrome Extension that allows users to search YouTube comments using both:

1. Traditional keyword search
2. AI-powered semantic search

The goal is to allow users to search for word in comment and also the meaning of comments rather than requiring exact words.

Example:
User searches: "windows"
the extension or the application should find comment that have the word "windows" in them 
also 
User searches:

"people complaining about installation"

The application should find comments such as:
s   
"Anyone else getting an error while installing this?"

even though the exact words "complaining about installation" do not appear.

---

## Architecture

The project should eventually contain:

* Chrome Extension
* Backend API
* PostgreSQL database
* pgvector for embeddings
* AI embedding provider

Use TypeScript throughout the project.

---

## Chrome Extension

Use:

* Chrome Manifest V3
* TypeScript
* Chrome Side Panel API
* Content scripts where necessary

The extension should:

* Detect the current YouTube video
* Get the YouTube video ID
* Open a side panel
* Allow the user to search comments
* Display search results
* Allow the user to click a result and jump to the corresponding YouTube comment

---

## Backend

Use:

* Node.js
* NestJS
* TypeScript

The backend will eventually:

* Fetch YouTube comments
* Store comments
* Generate embeddings
* Perform semantic search
* Return ranked results

---

## Database

Use:

* PostgreSQL
* pgvector

Comments should eventually contain:

* YouTube comment ID
* Video ID
* Author
* Comment text
* Like count
* Published date
* Updated date
* Parent comment ID
* Embedding

---

## Search

Support two search modes:

### Keyword

Traditional text matching.

Example:

"installation"

### Semantic

Meaning-based search.

Example:

"people having problems installing the software"

should find:

"Installation keeps failing on Windows."

Semantic search should use embeddings and vector similarity.

---

## Important principles

Do not build everything at once.

Work milestone by milestone.

Before implementing a milestone:

1. Inspect the repository.
2. Explain the implementation plan.
3. Implement only that milestone.
4. Run tests/build.
5. Fix errors.
6. Explain what changed.
7. Wait for the next instruction.

Do not silently skip milestones.

Do not add unnecessary dependencies.

Do not implement authentication, payments, subscriptions, or analytics in the MVP.

Keep the architecture simple and maintainable.

---

## MVP priority

The first working version should be:

YouTube video
→ get video ID
→ fetch comments
→ display comments
→ keyword search
→ semantic search
→ click result
→ jump to comment

AI summaries and advanced AI features come later.
