🚚 ZapShift Backend – Courier & Parcel Management System (Node + Express + MongoDB)

This is the backend of the ZapShift parcel delivery platform supporting authentication, role-based access, parcel booking, status updates, routing, and real-time tracking.

🚀 Live API

🔗 Backend: https://zap-shift-server-nine-plum.vercel.app

📌 Main Features

JWT Authentication (Customer, Admin, Delivery Agent)

Parcel CRUD

Assign delivery agents

Update parcel status

Real-time tracking (Socket.IO ready)

Basic analytics for Admin

map/route is frontend functionality)es

🛠 Technologies

Node.js + Express

MongoDB + Mongoose

Firebase JWT token verification

Stripe Payments

Role-Based Access Control

react-leafle Maps (geolocation + route optimization)

Firebase Authentication

Vercel Deployment
Cloud hosting: Vercel

📦 Installation
1️⃣ Clone
git clone https://github.com/nazmul5675/zap-shift-server.git
cd zap-shift-server

2️⃣ Install
npm install

3️⃣ Environment Variables
#Set your own environment variable

4️⃣ Run server
nodemon index.js

🔐 Authentication

Firebase Authentication is used for secure login. Server verifies JWT with Firebase Admin SDK.

Token required in all protected routes:

Authorization: Bearer <token>

🔥 API Documentation 
🧍 Auth APIs
✔ POST /api/auth/register

Create Customer/Admin/Agent user.

✔ POST /api/auth/login

Returns Firebase JWT token + role.

📦 Parcel APIs
✔ GET /api/parcels

Get all parcels (admin only).

✔ GET /api/parcels/customer/:email

Fetch all parcels for a customer.

✔ GET /api/parcels/assigned/:email

Fetch parcels assigned to delivery agent.

✔ POST /api/parcels

Create parcel booking.

✔ PATCH /api/parcels/:id

Update parcel by ID.

✔ PUT /api/parcels/assign-agent/:id

Admin assigns rider/agent.

✔ PUT /api/parcels/:id/status

Delivery agent updates parcel status.

✔ DELETE /api/parcels/:id

Delete parcel.

🧮 Admin APIs
✔ GET /api/admin/all-users

Returns list of:

Customers

Admins

Delivery Agents

✔ GET /api/admin/analytics

Returns:

Total parcels

Delivered

In transit

Failed

COD amounts

Daily bookings

💳 Payment (Stripe)
✔ POST /paymentCheckoutSession

Creates payment intent.

✔ GET /api/payments/history/:email

User payment history.

🛡 Security & Access Control

✔ Firebase JWT verification
✔ Role-based authorization
✔ Prevents unauthorized parcel access
✔ Verifies user email matches Firebase identity
✔ Secure CORS settings
✔ Stripe secure payments
