# Feedbase Backend

Feedbase Backend is a multi-tenant Node.js API for feedback collection, roadmap planning, changelog publishing, notifications, and tenant/user management.

## Highlights

- Multi-tenant architecture with tenant-scoped access control
- JWT authentication and role-based authorization
- Posts, votes, comments, tags, roadmap, and changelog workflows
- API key management, audit logs, and third-party integrations
- File upload support for profile and content assets

## Tech Stack

- Node.js + Express
- MySQL (`mysql2` pool)
- JWT (`jsonwebtoken`) + `bcrypt`
- `multer` and `sharp` for uploads/image handling
- PM2 + nodemon for runtime management

## API Docs And Import Files

- Human-readable endpoint list with sample payloads: `API_FULL_LIST.md` in the frontend repo (`D:\Development\Frontend\feedbase`) — the single canonical reference.
- `apidog-import-openapi.json`: OpenAPI file for APIdog import
- `postman-apidog-collection.json`: Postman collection (also APIdog compatible)
- `postman-apidog-environment.json`: sample environment for Postman/APIdog

## Quick Start

1. Install dependencies.

```bash
npm install
```

2. Create a MySQL database and import the schema.

```bash
mysql -u root -p < feedbase_db.sql
```

3. Create a `.env` file in the project root.

```env
APP_PORT=4560
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=feedbase_db

SECRET_ACCESS_TOKEN=your_secret_key
ACCESS_TOKEN_EXPIRE=24h
```

4. Start the development server.

```bash
npm run dev
```

## NPM Scripts

| Script | Command | Description |
| --- | --- | --- |
| `npm run dev` | `nodemon app.js` | Run locally with hot reload |
| `npm run staging` | `pm2 start ecosystem.config.js --env staging` | Start staging process |
| `npm start` | `pm2 start ecosystem.config.js --env production` | Start production process |
| `npm run restart` | `pm2 restart feedbase-server --env production` | Restart production process |
| `npm run restart:staging` | `pm2 restart feedbase-server --env staging` | Restart staging process |
| `npm run logs` | `pm2 logs feedbase-server` | Tail PM2 logs |
| `npm run stop` | `pm2 stop feedbase-server` | Stop PM2 process |
| `npm run delete` | `pm2 delete feedbase-server` | Remove PM2 process |

## Mounted Route Groups

The server mounts these route groups in `app.js`:

- `/tenants`
- `/users`
- `/posts`
- `/votes`
- `/comments`
- `/tags`
- `/roadmap`
- `/changelog`
- `/notifications`
- `/api-keys`
- `/audit-logs`
- `/integrations`
- `/uploader`
- `/uploads` (static files)

## Project Layout

```
feedbase-backend/
|-- app.js
|-- database/
|   `-- dbPool.js
|-- src/
|   |-- common/
|   |-- consts/
|   |-- main/
|   |-- middlewares/
|   `-- routes/
|-- uploads/
|-- feedbase_db.sql
|-- apidog-import-openapi.json
`-- postman-apidog-collection.json
```

## Deployment Notes

- See `DEPLOYMENT.md` for deployment and environment setup.
- PM2 configuration is defined in `ecosystem.config.js`.

## Git Notes

- `.gitignore` excludes local/runtime artifacts such as `node_modules`, `.env`, logs, coverage output, and uploaded files.
- `uploads/.gitkeep` is retained so the uploads directory exists after cloning.

## License

ISC
