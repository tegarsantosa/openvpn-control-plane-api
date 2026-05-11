# OpenVPN Control Plane API

A modern REST API for managing OpenVPN servers, clients, and automated tasks. Built with Node.js, Express, and PostgreSQL.

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- PostgreSQL 15+ (included in Docker)

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd openvpn-control-plane-api
   npm install
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```

3. **Start the services:**
   ```bash
   docker compose up -d
   npm run db:migrate
   npm start
   ```

4. **Access the API:**
   - API: `http://localhost:3000/api`
   - Swagger Docs: `http://localhost:3000/docs`
   - MailCatcher (emails): `http://localhost:1080`

---

## Server Registration Guide

This is a step-by-step guide to register a new OpenVPN server through the API.

### Prerequisites

- Admin account with verified email
- Server hostname/IP
- A location ID (for server region)
- curl or Postman installed

---

## Step 1: Register an Admin Account

Create a new admin user account:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d {
    "email": "admin@example.com",
    "password": "securepassword123",
    "name": "Admin User"
  }
```

**Response:**
```json
{
  "success": true,
  "message": "Registration successful. Please check your email to verify your account.",
  "user": {
    "id": 1,
    "email": "admin@example.com",
    "name": "Admin User"
  }
}
```

- Check your email and verify your account via the verification link
- Assign admin permissions directly from Psql

---

## Step 2: Get an Admin JWT Token

Log in to get your authentication token:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d {
    "email": "admin@example.com",
    "password": "securepassword123"
  }
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "admin@example.com",
    "name": "Admin User"
  }
}
```

**Keep the `token` value** — you'll need it for the next steps.

---

## Step 3: Get Available Locations

View available server locations:

```bash
curl -X GET http://localhost:3000/api/servers/locations \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
[
  {
    "id": 1,
    "country": "United States",
    "country_code": "US"
  },
  {
    "id": 2,
    "country": "Canada",
    "country_code": "CA"
  },
  {
    "id": 3,
    "country": "United Kingdom",
    "country_code": "GB"
  }
]
```

**Save the location ID** you want to use for your server.

---

## Step 4: Create a Server Registration Token

Generate a registration token for your server:

```bash
curl -X POST http://localhost:3000/api/servers \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d {
    "server_id": "vpn-us-01",
    "location_id": 1
  }
```

**Parameters:**
- `server_id`: Unique identifier for your server (e.g., `vpn-us-01`)
- `location_id`: ID from Step 3 (e.g., `1` for US)

**Response:**
```json
{
  "success": true,
  "server_id": "vpn-us-01",
  "registration_token": "a1b2c3d4e5f6...",
  "expires_at": "2024-05-12T10:30:00.000Z",
  "registration_url": "http://localhost:3000/api/servers/register/a1b2c3d4e5f6..."
}
```

**Keep the `registration_token` and `registration_url`** — valid for 24 hours.

---

## Step 5: Complete Server Registration

Run this command **on your physical/virtual server** to complete registration:

```bash
wget https://git.io/vpn -O openvpn-install.sh && sudo bash openvpn-install.sh
```

After this step, you might want to configure your OpenVPN settings. Follow the step until the installation succeed.

```bash
curl -fsSL "http://localhost:3000/api/servers/register/YOUR_REGISTRATION_TOKEN" | sudo bash
```

Replace `YOUR_REGISTRATION_TOKEN` with the token from Step 4.

**What this does:**
1. Validates the registration token
2. Generates a unique auth token for the server
3. Outputs the installation script

**The script will automatically:**
- Fetch the OpenVPN agent
- Install systemd service
- Enable automatic startup
- Start the agent service

**Example output:**
```
Server registered successfully!

Server ID:
  vpn-us-01

Next step — run this command on your server:

------------------------------------------------------------
curl -fsSL "http://localhost:3000/api/servers/agent/install.sh?token=AUTH_TOKEN_HERE" | sudo bash
------------------------------------------------------------

This will:
  • Download the OpenVPN agent
  • Install the systemd service
  • Enable & start the agent automatically

Notes:
  • Run as a user with sudo access
```

---

## Step 6: Verify Server Registration

Check if your server is registered and active:

```bash
curl -X GET http://localhost:3000/api/servers \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
[
  {
    "id": 1,
    "server_id": "vpn-us-01",
    "hostname": "vpn-us-01.example.com",
    "ip": "203.0.113.42",
    "is_active": true,
    "last_seen": "2024-05-11T10:25:30.000Z",
    "location_id": 1,
    "country": "United States",
    "country_code": "US",
    "client_count": 0,
    "created_at": "2024-05-11T10:20:00.000Z",
    "updated_at": "2024-05-11T10:25:30.000Z"
  }
]
```

✅ **Success!** Your server is now registered and active.

---

## Troubleshooting

### Registration Token Expired
**Error:** `Registration token expired. Please contact admin to generate a new token.`

**Solution:** Registration tokens expire after 24 hours. Create a new one with Step 4.

### Invalid Token
**Error:** `Invalid registration token`

**Solution:** Verify you're using the correct token from Step 4.

### Server Not Active
**Symptom:** Server doesn't appear in list after registration

**Solution:** 
1. Check server has internet connectivity
2. Verify firewall allows outbound HTTPS (port 443)
3. Check installation script ran without errors

### Permission Denied
**Error:** `You do not have admin permissions`

**Solution:** Your account needs admin role. Contact system administrator.

---

## Development

### Available Commands

```bash
npm start              # Start the API server
npm run dev           # Start with auto-reload (nodemon)
npm run db:migrate    # Run pending migrations
npm run db:rollback   # Rollback last migration
npm run db:reset      # Reset and re-run all migrations
npm run db:status     # Check migration status
```

### Database Migrations

Create a new migration:

```bash
# Create migration file in src/db/migrations/
# Format: NNN_description.sql (e.g., 003_add_users_table.sql)
npm run db:migrate
```
---

## Support & Documentation

- **API Docs:** Visit `http://localhost:3000/docs` (Swagger UI)
- **Issues:** Create an issue in the repository
- **Email:** hello@tegarsantosa.com
