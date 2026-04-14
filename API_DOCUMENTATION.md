# Feedbase Backend API Documentation

> Full endpoint reference with sample body and sample response for every API is available in `API_FULL_LIST.md`.

## Base URL
```
http://localhost:4560
```

## Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Common Request/Response Format

### Request Body Structure
```json
{
  "lg": "en",  // Language code (en, bn, etc.)
  "data": {}   // Endpoint-specific data
}
```

### Response Structure
```json
{
  "status": "success" | "failed",
  "message": "Human-readable message",
  "data": {}  // Optional response data
}
```

## API Endpoints

### 1. Tenants

#### Create Tenant
```http
POST /tenants/create
Content-Type: application/json

{
  "lg": "en",
  "tenantData": {
    "name": "Acme Corp",
    "slug": "acme-corp",
    "subdomain": "acme",
    "customDomain": "feedback.acme.com",
    "planName": "pro",
    "brandingLogoUrl": "https://cdn.example.com/logo.png",
    "brandingPrimaryColor": "#0A7CFF"
  }
}
```

#### Get Tenant by ID
```http
GET /tenants/:id
Authorization: Bearer <token>
```

#### Update Tenant
```http
PUT /tenants/update/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "tenantData": {
    "name": "Acme Corporation",
    "brandingLogoUrl": "https://cdn.example.com/new-logo.png",
    "brandingPrimaryColor": "#FF5733",
    "planName": "enterprise",
    "isActive": 1
  }
}
```

### 2. Users

#### Register
```http
POST /users/register
Content-Type: application/json

{
  "lg": "en",
  "userData": {
    "tenantId": 1,
    "email": "user@example.com",
    "password": "SecurePass123!",
    "fullName": "John Doe",
    "role": "user"
  }
}
```

#### Login
```http
POST /users/login
Content-Type: application/json

{
  "lg": "en",
  "userData": {
    "email": "user@example.com",
    "password": "SecurePass123!"
  }
}

Response:
{
  "status": "success",
  "message": "User logged in successfully",
  "user": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "id": 1,
    "fullName": "John Doe",
    "email": "user@example.com",
    "imageUrl": null
  }
}
```

#### Get Personal Data
```http
GET /users/personal-data
Authorization: Bearer <token>
```

#### Update User Role (Admin Only)
```http
PATCH /users/role/:userId
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "role": "moderator"
}
```

### 3. Posts

#### Create Post
```http
POST /posts/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "postData": {
    "title": "Add dark mode support",
    "description": "It would be great to have a dark mode option for the dashboard.",
    "postType": "feature_request",
    "status": "open",
    "priority": 2
  }
}
```

#### Get Post by ID
```http
GET /posts/:id
Authorization: Bearer <token>
```

#### Update Post
```http
PUT /posts/update/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "postData": {
    "title": "Add dark mode support (Updated)",
    "description": "Updated description...",
    "postType": "feature_request",
    "priority": 1
  }
}
```

#### Get Posts List
```http
POST /posts/list
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "paginationData": {
    "page": 1,
    "limit": 10
  },
  "filters": {
    "status": "open",
    "postType": "feature_request"
  }
}
```

#### Update Post Status
```http
PATCH /posts/status/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "newStatus": "in_progress"
}
```

### 4. Votes

#### Add Vote
```http
POST /votes/add
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "postId": 1
}
```

#### Remove Vote
```http
DELETE /votes/remove/:postId
Authorization: Bearer <token>
```

#### Get Post Votes
```http
GET /votes/post/:postId
Authorization: Bearer <token>
```

### 5. Comments

#### Create Comment
```http
POST /comments/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "commentData": {
    "postId": 1,
    "body": "Great idea! I would love to see this implemented.",
    "parentCommentId": null
  }
}
```

#### Update Comment
```http
PUT /comments/update/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "body": "Updated comment text..."
}
```

#### Get Post Comments
```http
GET /comments/post/:postId
Authorization: Bearer <token>
```

### 6. Tags

#### Create Tag
```http
POST /tags/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "tagData": {
    "name": "UI/UX",
    "colorHex": "#3B82F6"
  }
}
```

#### Add Tag to Post
```http
POST /tags/add-to-post
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "postId": 1,
  "tagId": 2
}
```

#### Get Tags List
```http
GET /tags/list
Authorization: Bearer <token>
```

### 7. Roadmap

#### Create Roadmap Column
```http
POST /roadmap/column/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "columnData": {
    "name": "In Progress",
    "columnKey": "in_progress",
    "sortOrder": 2
  }
}
```

#### Add Item to Roadmap
```http
POST /roadmap/item/add
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "itemData": {
    "postId": 1,
    "roadmapColumnId": 2,
    "sortOrder": 1,
    "targetReleaseDate": "2026-06-01"
  }
}
```

#### Get Roadmap Items
```http
GET /roadmap/items
Authorization: Bearer <token>
```

### 8. Changelog

#### Create Changelog
```http
POST /changelog/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "changelogData": {
    "title": "April 2026 Update",
    "summary": "New features and bug fixes",
    "content": "## New Features\n- Dark mode support\n- CSV export\n\n## Bug Fixes\n- Fixed mobile UI issues"
  }
}
```

#### Publish Changelog
```http
PATCH /changelog/publish/:id
Authorization: Bearer <token>
```

#### Get Changelog List
```http
POST /changelog/list
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "paginationData": {
    "page": 1,
    "limit": 10
  }
}
```

### 9. Notifications

#### Get Notifications
```http
POST /notifications/list
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "paginationData": {
    "page": 1,
    "limit": 20
  }
}
```

#### Mark as Read
```http
PATCH /notifications/mark-read/:id
Authorization: Bearer <token>
```

#### Get Unread Count
```http
GET /notifications/unread-count
Authorization: Bearer <token>
```

### 10. API Keys

#### Create API Key
```http
POST /api-keys/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "apiKeyData": {
    "keyName": "Production API Key",
    "scopes": ["read:posts", "write:posts", "read:analytics"],
    "expiresAt": "2027-04-12"
  }
}

Response:
{
  "status": "success",
  "message": "API key created successfully",
  "data": {
    "id": 1,
    "key": "fb_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6"
  }
}
```

#### Revoke API Key
```http
PATCH /api-keys/revoke/:id
Authorization: Bearer <token>
```

### 11. Integrations

#### Create Integration
```http
POST /integrations/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "integrationData": {
    "integrationType": "slack",
    "config": {
      "webhookUrl": "https://hooks.slack.com/services/T000/B000/XXX",
      "channel": "#feedback"
    }
  }
}
```

#### Toggle Integration
```http
PATCH /integrations/toggle/:id
Authorization: Bearer <token>
```

### 12. Audit Logs

#### Get Audit Logs
```http
POST /audit-logs/list
Authorization: Bearer <token>
Content-Type: application/json

{
  "lg": "en",
  "paginationData": {
    "page": 1,
    "limit": 50
  },
  "filters": {
    "action": "POST_CREATED",
    "entityType": "post"
  }
}
```

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Resource already exists |
| 500 | Internal Server Error - Server error |

## Post Types

- `feedback` - General feedback
- `feature_request` - Feature request
- `bug_report` - Bug report

## Post Status

- `open` - Newly created
- `planned` - Planned for development
- `in_progress` - Currently being worked on
- `completed` - Completed
- `closed` - Closed/rejected

## User Roles

- `visitor` - Can view public content
- `user` - Can create posts, vote, comment
- `moderator` - Can manage posts and comments
- `admin` - Can manage users and settings
- `owner` - Full access to tenant

## Integration Types

- `slack` - Slack integration
- `discord` - Discord integration
- `webhook` - Generic webhook
- `zapier` - Zapier integration

## Notification Types

- `post_status` - Post status changed
- `comment_reply` - Reply to comment
- `mention` - User mentioned
- `changelog` - New changelog published
- `system` - System notification
