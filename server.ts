import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";

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
  console.log("Initializing Firebase Admin for project:", firebaseConfig.projectId);
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

// Get services with explicit database ID
const db = getFirestore(firebaseConfig.firestoreDatabaseId);
const auth = getAuth();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  console.log("Admin Project ID:", admin.apps[0]?.options.projectId);

  const upload = multer({ storage: multer.memoryStorage() });

  // Proxy TinyVault Upload
  app.post("/api/proxy-upload", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const formData = new FormData();
      formData.append("file", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      console.log(`Proxying upload to TinyVault: ${req.file.originalname} (${req.file.size} bytes)`);

      const response = await axios.post("https://tinyvault.space/api/upload", formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000, // 30 seconds timeout
      });

      console.log("TinyVault response success");
      res.json(response.data);
    } catch (error: any) {
      const errorData = error?.response?.data;
      const errorMessage = error?.message;
      console.error("Proxy upload error:", errorData || errorMessage);
      
      // Check for Vercel timeout or network issues
      if (error.code === 'ECONNABORTED') {
        return res.status(504).json({ error: "Upload to TinyVault timed out. Please try a smaller file or check your connection." });
      }

      res.status(500).json({ 
        error: "Failed to proxy upload to TinyVault", 
        details: errorData || errorMessage,
        status: error?.response?.status
      });
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
        
        // Check if token project matches config project
        const tokenProjectId = payload.iss?.split('/').pop();
        if (tokenProjectId && tokenProjectId !== firebaseConfig.projectId) {
          console.warn(`Project ID mismatch! Token: ${tokenProjectId}, Config: ${firebaseConfig.projectId}`);
        }
      }
      
      console.log("Verifying token for project:", firebaseConfig.projectId);
      
      // Ensure we are using the correct auth instance
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      console.log("Token verified for UID:", decodedToken.uid);
      
      let userData: any = null;
      try {
        const userDoc = await db.collection("users").doc(decodedToken.uid).get();
        userData = userDoc.data();
      } catch (dbError: any) {
        console.error("Firestore access failed during checkAdmin:", dbError.message);
        // If firestore fails, we still have the token info
      }
      
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
      
      // Handle Identity Toolkit API disabled error
      if (error.message.includes('identitytoolkit.googleapis.com') || error.message.includes('SERVICE_DISABLED')) {
        const projectId = firebaseConfig.projectId;
        const numericProjectId = error.message.match(/project=([0-9]+)/)?.[1] || "your-project-id";
        return res.status(401).json({ 
          error: "Identity Toolkit API is disabled for this project.",
          details: `Bạn cần kích hoạt Identity Toolkit API trong Google Cloud Console cho dự án ${projectId}. Truy cập: https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${numericProjectId}`,
          code: 'auth/api-disabled'
        });
      }

      if (error.code === 'auth/project-not-found' || error.message.includes('NOT_FOUND')) {
        return res.status(401).json({ 
          error: `Invalid token: Project ${firebaseConfig.projectId} not found or mismatch. Please check your Firebase configuration.`,
          code: error.code
        });
      }
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
        createdAt: FieldValue.serverTimestamp(),
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
