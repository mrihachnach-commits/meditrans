import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load firebase config
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
if (!fs.existsSync(configPath)) {
  console.error("CRITICAL: firebase-applet-config.json not found at", configPath);
  console.log("Current directory:", process.cwd());
  console.log("Files in current directory:", fs.readdirSync(process.cwd()));
  throw new Error("firebase-applet-config.json missing. Please ensure it is uploaded to Vercel.");
}
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Set environment variables for firebase-admin
process.env.GOOGLE_CLOUD_PROJECT = firebaseConfig.projectId;

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = admin.firestore();
const auth = admin.auth();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  console.log("Admin Project ID:", admin.apps[0]?.options.projectId);

  // Proxy TinyVault Upload (Vercel-style proxy for local dev/Cloud Run)
  app.post("/api/tinyvault", async (req, res) => {
    try {
      // We need to forward the multipart request to TinyVault
      // Since we don't want to use multer/form-data here to keep it simple,
      // and the user wants a "direct" feel, we'll use a simple fetch-based proxy
      // but we need to handle the stream.
      
      // However, for Cloud Run/Local Dev, the easiest is to use the direct URL if possible,
      // but CORS is the issue. Let's use the proxy pattern but with a simple implementation.
      
      // Re-importing necessary tools for the proxy
      const { default: axios } = await import("axios");
      const { default: FormData } = await import("form-data");
      const { default: multer } = await import("multer");
      const upload = multer({ storage: multer.memoryStorage() });

      upload.single("file")(req, res, async (err) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const formData = new FormData();
        formData.append("file", req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
        });

        const response = await axios.post("https://tinyvault.space/api/upload", formData, {
          headers: { ...formData.getHeaders() },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });
        res.json(response.data);
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Middleware to check if user is admin
  const checkAdmin = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken || idToken === "null" || idToken === "undefined") {
      console.error("Token is missing or null");
      return res.status(401).json({ error: "Invalid token: Token is missing or null" });
    }
    try {
      // Manual decode for debugging
      const parts = idToken.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        console.log("Token Payload AUD:", payload.aud);
        console.log("Token Payload ISS:", payload.iss);
      }
      
      console.log("Verifying token for project:", firebaseConfig.projectId);
      console.log("Token prefix:", idToken.substring(0, 15));
      const decodedToken = await auth.verifyIdToken(idToken);
      console.log("Token verified for UID:", decodedToken.uid);
      const userDoc = await db.collection("users").doc(decodedToken.uid).get();
      const userData = userDoc.data();
      
      // Hardcoded admin check as fallback (same as firestore.rules)
      const isAdmin = userData?.role === "admin" || 
                      decodedToken.email === "mrihachnach@gmail.com" || 
                      decodedToken.email === "admin@gmail.com";

      if (!isAdmin) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }
      req.user = decodedToken;
      next();
    } catch (error: any) {
      console.error("Token verification failed:", error.message);
      res.status(401).json({ error: `Invalid token: ${error.message}` });
    }
  };

  // API Routes
  
  // Admin: Create User
  app.post("/api/admin/create-user", checkAdmin, async (req, res) => {
    const { email, password, displayName, role } = req.body;
    try {
      const userRecord = await auth.createUser({
        email,
        password,
        displayName,
      });
      
      // Create user document in Firestore
      await db.collection("users").doc(userRecord.uid).set({
        uid: userRecord.uid,
        email,
        displayName,
        role: role || "user",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      res.json({ success: true, uid: userRecord.uid });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Admin: Reset Password for any user
  app.post("/api/admin/reset-password", checkAdmin, async (req, res) => {
    const { uid, newPassword } = req.body;
    try {
      await auth.updateUser(uid, {
        password: newPassword,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // User: Change own password
  app.post("/api/user/change-password", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const idToken = authHeader.split("Bearer ")[1];
    const { newPassword } = req.body;
    
    try {
      const decodedToken = await auth.verifyIdToken(idToken);
      await auth.updateUser(decodedToken.uid, {
        password: newPassword,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Admin: List Users
  app.get("/api/admin/users", checkAdmin, async (req, res) => {
    try {
      const usersSnapshot = await db.collection("users").get();
      const users = usersSnapshot.docs.map(doc => doc.data());
      res.json({ users });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.env.NODE_ENV !== "production") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  return app;
}

const serverPromise = startServer();

export default async (req: any, res: any) => {
  const app = await serverPromise;
  return app(req, res);
};
