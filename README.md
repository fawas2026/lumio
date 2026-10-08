# Lumio

A free streaming site (no payments, ever) with a small Node backend.
No `npm install` is needed: the server uses only what ships with Node 22.13 or newer.

## Run it

    npm start

Open http://localhost:3000. Sign up, then browse, search, save titles to My List and watch.

## Layout

    public/index.html   The website (HTML, CSS and JavaScript in one file)
    server/index.js     HTTP server, API routes, static file serving
    server/db.js        SQLite tables and first-run seeding
    server/auth.js      Password hashing (scrypt) and signed login tokens
    server/titles.json  Sample catalogue loaded into the database on first run
    data/               Created at runtime: lumio.db and the token secret (do not commit)

## API

    POST   /api/signup          {name, email, password}  returns {token, user}
    POST   /api/login           {email, password}        returns {token, user}
    GET    /api/me                                        profile, watchlist, progress
    GET    /api/titles          ?q= &type= &genre= &country=
    GET    /api/titles/:id
    GET    /api/regions                                   countries with title counts
    PUT    /api/watchlist/:id   add to My List
    DELETE /api/watchlist/:id   remove from My List
    PUT    /api/progress/:id    {percent: 0-100}         Continue Watching

Logged-in routes need the header `Authorization: Bearer <token>`.

## Settings (environment variables)

    PORT            default 3000
    TOKEN_SECRET    signs login tokens; set it in production (otherwise one is generated in data/.secret)
    DB_FILE         path to the SQLite file (default data/lumio.db)

## Before going live

- Serve it over HTTPS (a reverse proxy such as Caddy or nginx, or a host that provides it).
- Set TOKEN_SECRET and back up the data/ folder.
- Add email verification and password reset if you want account recovery.
- Replace the demo player with real video (hosted files or an embed) and add your own titles.
