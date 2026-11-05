# Security Rules

1. **Zero Secret Exposure**:
   - Never hardcode API keys, tokens, or credentials in any file.
   - Never read, write, or print the contents of `.env` or any `.env*` file via file tools or shell commands.
   - Never prefix server API keys with `NEXT_PUBLIC_`.
2. **Ephemeral WebRTC Authentication**:
   - Browser WebRTC authenticates exclusively with short-lived ephemeral tokens issued by a backend route. The exact route and endpoint are decided by the planner after checking current OpenAI documentation.
3. **Server-Side Ingestion & Sanitization**:
   - File uploads (PDF ≤ 25 MB) and YouTube URLs must be validated and processed server-side.
   - Validate file MIME types and size boundaries before initiating text extraction.
