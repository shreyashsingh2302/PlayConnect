# PlayConnect

A full-stack website for organising sports sessions and online gaming teams.

## Author

Shreyash Singh 

B.Tech Information Technology, MIT Manipal  

## Features

1. Accounts and profiles: registration, login, logout, account deletion,
   and activity-specific player skill levels.
2. Session management: create, edit, cancel, and complete sports or gaming sessions.
3. Discovery: search and filter sessions by category, skill, date, and availability.
4. Participation: join requests, host approval, capacity limits, skill eligibility,
   schedule conflict checks, and withdrawal restrictions.
5. Real-time chat: messaging for hosts and accepted players.
6. Dashboard and notifications: upcoming sessions, request summaries,
   and updates about session activity.
7. History: completed sessions hosted or attended by the user.

## Technology stack

- React and Vite
- CSS
- Node.js and Express
- SQLite using the built-in node:sqlite module
- Socket.IO
- bcryptjs
- express-session

## Project structure

- client: React frontend and Vite configuration
- server: Express API, database logic, and Socket.IO chat
- .gitignore: excludes dependencies, generated files, and local data

## Requirements

Node.js with support for the built-in node:sqlite module.

Developed using Node.js 26.13.0 and npm 11.20.0.

## Run locally

Download this repository and extract it.

Open a terminal in the project folder and run:

```bash
cd server
npm install
node --watch index.cjs
```

Open a second terminal in the project folder and run:

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

The backend runs on port 3001. Vite proxies API and Socket.IO requests
to the backend.

The database is created automatically when the backend starts.
Register a new account through the website.

## Build the frontend

From the project folder:

```bash
cd client
npm run build
```

The frontend build is generated in client/dist.
The backend is still required for database, account, and chat functionality.

## Participation rules

- Players set a separate skill level for each activity.
- Skill eligibility is checked when applying.
- Changing skill levels later does not automatically remove accepted players.
- Pending requests do not reserve a place.
- Accepting a request checks capacity and schedule conflicts again.
- Accepted players cannot leave within 30 minutes of the session start
  or after it begins.
- Pending requests can be withdrawn.
- Hosts can mark a session completed after its end time.
- Completed and cancelled sessions do not allow new chat messages.

## Demonstration

1. Register two accounts using separate browser sessions.
2. Set their activity-specific skill levels.
3. Create a future session with start and end times.
4. Apply from the second account.
5. Accept the request from the host account.
6. Exchange messages in the session chat.
7. Demonstrate eligibility and schedule-conflict checks.
8. Check dashboard notifications.
9. After the session ends, mark it completed and view its history.

## Data and deployment notes

The local SQLite database and installed dependencies are not included
in this repository.

Login sessions use an in-memory store, so restarting the backend
requires users to sign in again.

The project is configured for local demonstration. Public deployment
requires production session storage, HTTPS, and appropriate server
configuration.

## Individual contribution

Shreyash Singh developed the frontend, backend, database, authentication,
profiles, session management, participation rules, chat, dashboard,
notifications, and project documentation.
