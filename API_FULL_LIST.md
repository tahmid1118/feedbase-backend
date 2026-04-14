# Feedbase Full API List

## Base URL

`http://localhost:4560`

## Headers

- `Authorization: Bearer <jwt_token>` for protected routes
- `Content-Type: application/json` for JSON endpoints
- `Content-Type: multipart/form-data` for file upload

## Notes

- `lg` is required on routes using `languageValidator`.
- Several GET/DELETE/PATCH routes still read `lg` from request body.
- Success response shape is usually `{ status, message, data? }`.
- Login returns `user` instead of `data`.
- Image upload returns `filePath`.

---

## 1) Tenant APIs

### POST /tenants/create
Sample Body:
```json
{"lg":"en","tenantData":{"name":"Acme Labs","slug":"acme-labs","subdomain":"acme","customDomain":"feedback.acme.test","planName":"pro","brandingLogoUrl":"https://cdn.example.com/acme/logo.png","brandingPrimaryColor":"#0A7CFF"}}
```
Sample Response:
```json
{"status":"success","message":"Tenant created successfully","data":{"id":1}}
```

### POST /tenants/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Tenant retrieved successfully","data":{"id":1,"name":"Acme Labs","slug":"acme-labs","subdomain":"acme","custom_domain":"feedback.acme.test","plan_name":"pro","branding_logo_url":"https://cdn.example.com/acme/logo.png","branding_primary_color":"#0A7CFF","is_active":1}}
```

### PUT /tenants/update/:id
Sample Body:
```json
{"lg":"en","tenantData":{"name":"Acme Corporation","brandingLogoUrl":"https://cdn.example.com/acme/new-logo.png","brandingPrimaryColor":"#1B8A5A","planName":"enterprise","isActive":1}}
```
Sample Response:
```json
{"status":"success","message":"Tenant updated successfully"}
```

### POST /tenants
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Tenants retrieved successfully","data":[{"id":1,"name":"Acme Labs","slug":"acme-labs","subdomain":"acme","plan_name":"pro","is_active":1}]}
```

---

## 2) User APIs

### POST /users/login
Sample Body:
```json
{"lg":"en","userData":{"email":"owner@acme.test","password":"SecurePass123!"}}
```
Sample Response:
```json
{"status":"success","message":"User logged in successfully","user":{"token":"eyJ...","id":1,"fullName":"Acme Owner","email":"owner@acme.test","imageUrl":"uploads/profile-images/image-1712901234567.jpeg"}}
```

### POST /users/register
Sample Body:
```json
{"lg":"en","userData":{"fullName":"Jane Product","email":"jane@acme.test","contact":"+8801712345678","password":"SecurePass123!"}}
```
Sample Response:
```json
{"status":"success","message":"Sign up is successful"}
```

### GET /users/personal-data
Sample Body:
```json
{}
```
Sample Response:
```json
{"status":"success","message":"Data fetched successfully","data":{"user_id":1,"full_name":"Acme Owner","email":"owner@acme.test","contact_no":"+8801712345678"}}
```

### POST /users/update
Sample Body:
```json
{"lg":"en","userData":{"userId":1,"fullName":"Acme Owner Updated","contact":"+8801711111111"}}
```
Sample Response:
```json
{"status":"success","message":"Profile updated successfully"}
```

### PATCH /users/role/:userId
Sample Body:
```json
{"lg":"en","role":"moderator"}
```
Sample Response:
```json
{"status":"success","message":"User role updated successfully"}
```

### POST /users/table-data
Sample Body:
```json
{"paginationData":{"itemsPerPage":10,"currentPageNumber":0,"sortOrder":"desc","filterBy":""}}
```
Sample Response:
```json
{"status":"success","message":"User data fetched successfully","data":{"metadata":{"totalRows":124},"tableData":[{"user_id":1,"full_name":"Acme Owner","email":"owner@acme.test"}]}}
```

### POST /users/user-list
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"User data fetched successfully","data":[{"user_id":1,"full_name":"Acme Owner","email":"owner@acme.test"}]}
```

### POST /users/change-password
Sample Body:
```json
{"lg":"en","oldPassword":"SecurePass123!","newPassword":"NewSecurePass456!"}
```
Sample Response:
```json
{"status":"success","message":"Password updated successfully"}
```

---

## 3) Post APIs

### POST /posts/create
Sample Body:
```json
{"lg":"en","postData":{"title":"Add dark mode","description":"Please add dark mode support for the dashboard.","postType":"feature_request","status":"open","priority":2}}
```
Sample Response:
```json
{"status":"success","message":"Post created successfully","data":{"id":101}}
```

### POST /posts/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Post retrieved successfully","data":{"id":101,"title":"Add dark mode","description":"Please add dark mode support for the dashboard.","post_type":"feature_request","status":"open","priority":2,"author_name":"Jane Product","author_email":"jane@acme.test","vote_count":12,"comment_count":4}}
```

### PUT /posts/update/:id
Sample Body:
```json
{"lg":"en","postData":{"title":"Add dark mode support","description":"Please add dark mode and theme persistence.","postType":"feature_request","priority":1}}
```
Sample Response:
```json
{"status":"success","message":"Post updated successfully"}
```

### DELETE /posts/delete/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Post deleted successfully"}
```

### POST /posts/list
Sample Body:
```json
{"lg":"en","paginationData":{"itemsPerPage":10,"currentPageNumber":0,"sortOrder":"desc","filterBy":""},"filters":{"status":"open","postType":"feature_request"}}
```
Sample Response:
```json
{"status":"success","message":"Posts retrieved successfully","data":{"posts":[{"id":101,"title":"Add dark mode","post_type":"feature_request","status":"open","priority":2,"author_name":"Jane Product","vote_count":12}],"total":38}}
```

### PATCH /posts/status/:id
Sample Body:
```json
{"lg":"en","newStatus":"in_progress"}
```
Sample Response:
```json
{"status":"success","message":"Post status updated successfully"}
```

---

## 4) Vote APIs

### POST /votes/add
Sample Body:
```json
{"lg":"en","postId":101}
```
Sample Response:
```json
{"status":"success","message":"Vote added successfully"}
```

### DELETE /votes/remove/:postId
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Vote removed successfully"}
```

### POST /votes/post/:postId
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Votes retrieved successfully","data":[{"id":301,"post_id":101,"user_id":3,"vote_type":"upvote","full_name":"Jane Product","email":"jane@acme.test"}]}
```

---

## 5) Comment APIs

### POST /comments/create
Sample Body:
```json
{"lg":"en","commentData":{"postId":101,"body":"Great request. We need this soon.","parentCommentId":null}}
```
Sample Response:
```json
{"status":"success","message":"Comment created successfully","data":{"id":401}}
```

### PUT /comments/update/:id
Sample Body:
```json
{"lg":"en","body":"Updated comment text"}
```
Sample Response:
```json
{"status":"success","message":"Comment updated successfully"}
```

### DELETE /comments/delete/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Comment deleted successfully"}
```

### POST /comments/post/:postId
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Comments retrieved successfully","data":[{"id":401,"post_id":101,"author_id":3,"body":"Great request. We need this soon.","is_edited":0,"author_name":"Jane Product","author_email":"jane@acme.test"}]}
```

---

## 6) Tag APIs

### POST /tags/create
Sample Body:
```json
{"lg":"en","tagData":{"name":"ui","colorHex":"#3B82F6"}}
```
Sample Response:
```json
{"status":"success","message":"Tag created successfully","data":{"id":501}}
```

### PUT /tags/update/:id
Sample Body:
```json
{"lg":"en","tagData":{"name":"ux","colorHex":"#2563EB"}}
```
Sample Response:
```json
{"status":"success","message":"Tag updated successfully"}
```

### DELETE /tags/delete/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Tag deleted successfully"}
```

### POST /tags/list
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Tags retrieved successfully","data":[{"id":501,"name":"ui","color_hex":"#3B82F6"}]}
```

### POST /tags/add-to-post
Sample Body:
```json
{"lg":"en","postId":101,"tagId":501}
```
Sample Response:
```json
{"status":"success","message":"Tag added to post successfully"}
```

### DELETE /tags/remove-from-post
Sample Body:
```json
{"lg":"en","postId":101,"tagId":501}
```
Sample Response:
```json
{"status":"success","message":"Tag removed from post successfully"}
```

---

## 7) Roadmap APIs

### POST /roadmap/column/create
Sample Body:
```json
{"lg":"en","columnData":{"name":"In Progress","columnKey":"in_progress","sortOrder":2}}
```
Sample Response:
```json
{"status":"success","message":"Roadmap column created successfully","data":{"id":601}}
```

### PUT /roadmap/column/update/:id
Sample Body:
```json
{"lg":"en","columnData":{"name":"Planned","sortOrder":1}}
```
Sample Response:
```json
{"status":"success","message":"Roadmap column updated successfully"}
```

### DELETE /roadmap/column/delete/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Roadmap column deleted successfully"}
```

### POST /roadmap/columns
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Roadmap columns retrieved successfully","data":[{"id":601,"name":"Planned","column_key":"planned","sort_order":1}]}
```

### POST /roadmap/item/add
Sample Body:
```json
{"lg":"en","itemData":{"postId":101,"roadmapColumnId":601,"sortOrder":1,"targetReleaseDate":"2026-06-01"}}
```
Sample Response:
```json
{"status":"success","message":"Roadmap item added successfully","data":{"id":701}}
```

### PUT /roadmap/item/update/:id
Sample Body:
```json
{"lg":"en","itemData":{"roadmapColumnId":602,"sortOrder":1,"targetReleaseDate":"2026-06-15"}}
```
Sample Response:
```json
{"status":"success","message":"Roadmap item updated successfully"}
```

### DELETE /roadmap/item/remove/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Roadmap item removed successfully"}
```

### POST /roadmap/items
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Roadmap items retrieved successfully","data":[{"id":701,"post_id":101,"roadmap_column_id":601,"sort_order":1,"target_release_date":"2026-06-01","title":"Add dark mode","column_name":"Planned"}]}
```

---

## 8) Changelog APIs

### POST /changelog/create
Sample Body:
```json
{"lg":"en","changelogData":{"title":"April 2026 Update","summary":"Dark mode planning and bug fixes","content":"## New Features\n- Dark mode planning"}}
```
Sample Response:
```json
{"status":"success","message":"Changelog created successfully","data":{"id":801}}
```

### PUT /changelog/update/:id
Sample Body:
```json
{"lg":"en","changelogData":{"title":"April 2026 Update (Edited)","summary":"Dark mode planning and UX improvements","content":"Updated markdown content"}}
```
Sample Response:
```json
{"status":"success","message":"Changelog updated successfully"}
```

### DELETE /changelog/delete/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Changelog deleted successfully"}
```

### POST /changelog/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Changelog retrieved successfully","data":{"id":801,"title":"April 2026 Update","summary":"Dark mode planning and bug fixes","content":"## New Features\n- Dark mode planning","is_published":1,"created_by_name":"Acme Owner"}}
```

### POST /changelog/list
Sample Body:
```json
{"lg":"en","paginationData":{"itemsPerPage":10,"currentPageNumber":0,"sortOrder":"desc","filterBy":""}}
```
Sample Response:
```json
{"status":"success","message":"Changelogs retrieved successfully","data":{"changelogs":[{"id":801,"title":"April 2026 Update","summary":"Dark mode planning and bug fixes","is_published":1,"created_by_name":"Acme Owner"}],"total":12}}
```

### PATCH /changelog/publish/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Changelog published successfully"}
```

---

## 9) Notification APIs

### POST /notifications/list
Sample Body:
```json
{"lg":"en","paginationData":{"itemsPerPage":20,"currentPageNumber":0,"sortOrder":"desc","filterBy":""}}
```
Sample Response:
```json
{"status":"success","message":"Notifications retrieved successfully","data":{"notifications":[{"id":901,"notification_type":"post_status","title":"Post moved to planned","message":"Add dark mode is now planned.","is_read":0}],"total":4}}
```

### PATCH /notifications/mark-read/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Notification marked as read"}
```

### PATCH /notifications/mark-all-read
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"All notifications marked as read"}
```

### DELETE /notifications/delete/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Notification deleted successfully"}
```

### POST /notifications/unread-count
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Unread count retrieved successfully","data":{"unreadCount":3}}
```

---

## 10) API Key APIs

### POST /api-keys/create
Sample Body:
```json
{"lg":"en","apiKeyData":{"keyName":"Production API Key","scopes":["read:posts","write:posts","read:analytics"],"expiresAt":"2027-04-12 00:00:00"}}
```
Sample Response:
```json
{"status":"success","message":"API key created successfully","data":{"id":1001,"key":"fb_7f6312f2c6f8b8f6f9f86a7f0d7c8a8c4d9b1e0ff5f8c1234567890abcd"}}
```

### PUT /api-keys/update/:id
Sample Body:
```json
{"lg":"en","apiKeyData":{"keyName":"Readonly Widget Key","scopes":["read:posts"]}}
```
Sample Response:
```json
{"status":"success","message":"API key updated successfully"}
```

### PATCH /api-keys/revoke/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"API key revoked successfully"}
```

### POST /api-keys/list
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"API keys retrieved successfully","data":[{"id":1001,"key_name":"Production API Key","key_prefix":"fb_7f6312","scopes":"[\"read:posts\",\"write:posts\"]","last_used_at":"2026-04-12T10:00:00.000Z","expires_at":"2027-04-12T00:00:00.000Z","is_revoked":0}]}
```

---

## 11) Audit Log APIs

### POST /audit-logs/list
Sample Body:
```json
{"lg":"en","paginationData":{"itemsPerPage":20,"currentPageNumber":0,"sortOrder":"desc","filterBy":""},"filters":{"action":"POST_CREATED","entityType":"post"}}
```
Sample Response:
```json
{"status":"success","message":"Audit logs retrieved successfully","data":{"logs":[{"id":1101,"action":"POST_CREATED","entity_type":"post","entity_id":101,"metadata":"{\"title\":\"Add dark mode\"}","actor_name":"Acme Owner"}],"total":97}}
```

### POST /audit-logs/create
Sample Body:
```json
{"lg":"en","logData":{"action":"POST_CREATED","entityType":"post","entityId":101,"metadata":{"title":"Add dark mode"},"ipAddress":"127.0.0.1","userAgent":"Mozilla/5.0"}}
```
Sample Response:
```json
{"status":"success","message":"Audit log created successfully"}
```

---

## 12) Integration APIs

### POST /integrations/create
Sample Body:
```json
{"lg":"en","integrationData":{"integrationType":"slack","config":{"webhookUrl":"https://hooks.slack.com/services/T000/B000/XXX","channel":"#product-feedback"}}}
```
Sample Response:
```json
{"status":"success","message":"Integration created successfully","data":{"id":1201}}
```

### PUT /integrations/update/:id
Sample Body:
```json
{"lg":"en","integrationData":{"config":{"webhookUrl":"https://hooks.slack.com/services/T000/B000/UPDATED","channel":"#feedback-updates"}}}
```
Sample Response:
```json
{"status":"success","message":"Integration updated successfully"}
```

### DELETE /integrations/delete/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Integration deleted successfully"}
```

### POST /integrations/list
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Integrations retrieved successfully","data":[{"id":1201,"integration_type":"slack","config":"{\"webhookUrl\":\"https://hooks.slack.com/services/T000/B000/XXX\",\"channel\":\"#product-feedback\"}","is_active":1}]}
```

### PATCH /integrations/toggle/:id
Sample Body:
```json
{"lg":"en"}
```
Sample Response:
```json
{"status":"success","message":"Integration toggled successfully"}
```

---

## 13) File Upload API

### POST /uploader/upload-image
Sample Body (multipart/form-data):
```txt
upload_image: <binary image>
lg: en
```
Sample Response:
```json
{"status":"success","message":"Image uploaded successfully","filePath":"uploads/profile-images/image-1712901234567.jpeg"}
```

---

## Enum Values

### Post Types
- `feedback`
- `feature_request`
- `bug_report`

### Post Status
- `open`
- `planned`
- `in_progress`
- `completed`
- `closed`

### Roles
- `visitor`
- `user`
- `moderator`
- `admin`
- `owner`

### Integration Types
- `slack`
- `discord`
- `webhook`
- `zapier`

### Notification Types
- `post_status`
- `comment_reply`
- `mention`
- `changelog`
- `system`
