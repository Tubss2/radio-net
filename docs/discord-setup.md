# Discord developer app: setup steps (LATER, not needed for the MVP)

> **Status: backlog.** Radio Net's MVP doesn't use Discord at all: communities, invites and channels live in the app. Only do this if we later add "Sign in with Discord" or link a community to a Discord server. ~5 minutes.

1. Go to **https://discord.com/developers/applications** and log in.
2. Click **New Application** (top right). Name it `Radio Net` (or the final name), tick the terms box, then **Create**.
3. On **General Information**: optionally upload an icon. Copy the **Application ID** (this is the *Client ID*). It's not secret and can go in chat.
4. Left menu → **OAuth2**:
   - Under **Redirects**, click **Add Redirect** and paste the placeholder `https://api.<our-domain>/auth/discord/callback`. I'll give you the exact URL once we've picked a domain. Then **Save Changes**.
   - Under **Client Secret**, click **Reset Secret** and confirm. Discord shows the secret **once**.
5. **Don't paste the Client Secret into chat or email.** When we get there, the app/server setup will show a **secure prompt** where you paste it directly, and it's stored encrypted on the server. If it ever leaks, just **Reset Secret** again.
6. Leave **Bot** alone. We don't need a bot for login.

Scopes we'd request later: `identify` (who you are) and `guilds.members.read` (your roles in a linked server). Members would see "Radio Net wants to: access your username and avatar, read your member info in servers".
