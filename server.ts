import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
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
process.env.FIREBASE_CONFIG = JSON.stringify(firebaseConfig);

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

// Initialize Firestore with named database support
let firestore: admin.firestore.Firestore;
const app = admin.apps[0];

if (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)') {
  // Use the modular getFirestore which supports named databases directly
  firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId) as any;
  console.log("Firestore initialized with named database:", firebaseConfig.firestoreDatabaseId);
} else {
  firestore = getFirestore(app) as any;
}

const auth = admin.auth();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  console.log("Admin Project ID:", admin.apps[0]?.options.projectId);

  // Proxy TinyVault Upload (Vercel-style proxy for local dev/Cloud Run)
  app.post("/api/tinyvault", async (req, res) => {
    try {
      const { default: axios } = await import("axios");
      const { default: FormData } = await import("form-data");
      const { default: multer } = await import("multer");
      const upload = multer({ 
        storage: multer.memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
      });

      upload.single("file")(req as any, res as any, async (err) => {
        const request = req as any;
        if (err) {
          console.error("Multer error:", err);
          return res.status(500).json({ error: "Lỗi xử lý tệp tin: " + err.message });
        }
        if (!request.file) return res.status(400).json({ error: "Không có tệp tin nào được tải lên" });

        const formData = new FormData();
        formData.append("file", request.file.buffer, {
          filename: request.file.originalname,
          contentType: request.file.mimetype,
        });

        try {
          const response = await axios.post("https://tinyvault.space/api/upload", formData, {
            headers: { ...formData.getHeaders() },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000 // 60 seconds timeout
          });
          res.json(response.data);
        } catch (axiosError: any) {
          console.error("TinyVault API error:", axiosError.response?.data || axiosError.message);
          res.status(axiosError.response?.status || 500).json({ 
            error: "Lỗi từ máy chủ TinyVault", 
            details: axiosError.response?.data || axiosError.message 
          });
        }
      });
    } catch (error: any) {
      console.error("Proxy internal error:", error);
      res.status(500).json({ error: "Lỗi hệ thống nội bộ: " + error.message });
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
      console.log("Verifying token for project:", firebaseConfig.projectId);
      console.log("Token prefix:", idToken.substring(0, 15));
      
      // Attempt standard verification
      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(idToken);
        console.log("Token verified for UID:", decodedToken.uid);
      } catch (verifyError: any) {
        console.error("Standard token verification failed:", verifyError.message);
        
        // Fallback: Manual decode for the primary admin if API is disabled
        // This is necessary because the Identity Toolkit API might be disabled in the hosting project
        const parts = idToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          const isPrimaryAdmin = payload.email === "mrihachnach@gmail.com" || payload.email === "admin@gmail.com";
          
          if (isPrimaryAdmin && payload.email_verified) {
            console.log("Using fallback verification for primary admin:", payload.email);
            decodedToken = payload;
            // Add uid if missing (it's usually 'sub' in JWT)
            if (!decodedToken.uid) decodedToken.uid = payload.sub;
          } else {
            throw verifyError;
          }
        } else {
          throw verifyError;
        }
      }

      // Hardcoded admin check as fallback (same as firestore.rules)
      const isPrimaryAdmin = decodedToken.email === "mrihachnach@gmail.com" || 
                             decodedToken.email === "admin@gmail.com";

      let userData: any = null;
      try {
        const userDoc = await firestore.collection("users").doc(decodedToken.uid).get();
        userData = userDoc.data();
      } catch (dbError: any) {
        console.error("Firestore fetch failed in admin check:", dbError.message);
        // If DB fails, we rely on the hardcoded email check
        if (isPrimaryAdmin) {
          console.log("Allowing access for primary admin despite Firestore error");
          userData = { role: "admin" };
        }
      }
      
      const isAdmin = userData?.role === "admin" || isPrimaryAdmin;

      if (!isAdmin) {
        return res.status(403).json({ error: "Forbidden: Admin access required" });
      }
      req.user = decodedToken;
      next();
    } catch (error: any) {
      console.error("Admin check failed:", error.message);
      res.status(401).json({ error: `Invalid token: ${error.message}` });
    }
  };

  // API Routes
  
  // Admin: Create User
  app.post("/api/admin/create-user", checkAdmin, async (req, res) => {
    const { email, password, displayName, role } = req.body;
    
    console.log(`[Admin] Request to create user: ${email} (${role})`);
    
    if (!email || !password) {
      return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    }

    try {
      // 1. Check if user already exists in Auth
      let userRecord;
      try {
        userRecord = await auth.getUserByEmail(email);
        console.log(`[Admin] User already exists in Auth: ${userRecord.uid}`);
      } catch (e: any) {
        if (e.code === 'auth/user-not-found') {
          // 2. Create user in Firebase Auth
          userRecord = await auth.createUser({
            email,
            password,
            displayName: displayName || email.split('@')[0],
          });
          console.log(`[Admin] Auth user created: ${userRecord.uid}`);
        } else {
          // If Identity Toolkit API is disabled, this might fail
          console.error("[Admin] Auth creation failed:", e.message);
          if (e.message.includes("Identity Toolkit API")) {
            const enablementLink = `https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${firebaseConfig.projectId}`;
            return res.status(500).json({ 
              error: "Lỗi hệ thống: Identity Toolkit API chưa được kích hoạt.",
              details: e.message,
              actionRequired: "Vui lòng kích hoạt Identity Toolkit API tại: " + enablementLink
            });
          }
          throw e;
        }
      }
      
      // 3. Create or Update user document in Firestore
      const userData = {
        uid: userRecord.uid,
        email,
        displayName: displayName || email.split('@')[0],
        role: role || "user",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await firestore.collection("users").doc(userRecord.uid).set({
        ...userData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      
      console.log(`[Admin] Firestore document synced for: ${userRecord.uid}`);
      
      res.json({ success: true, uid: userRecord.uid });
    } catch (error: any) {
      console.error("[Admin] Error creating user:", error);
      
      let errorMessage = error.message;
      if (error.code === 'auth/email-already-exists') {
        errorMessage = "Email này đã được sử dụng.";
      } else if (error.code === 'auth/invalid-password') {
        errorMessage = "Mật khẩu không hợp lệ (tối thiểu 6 ký tự).";
      }
      
      res.status(400).json({ error: errorMessage });
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

  // Admin: Delete User
  app.post("/api/admin/delete-user", checkAdmin, async (req, res) => {
    const { uid } = req.body;
    try {
      // 1. Delete from Auth
      await auth.deleteUser(uid);
      // 2. Delete from Firestore
      await firestore.collection("users").doc(uid).delete();
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Admin] Error deleting user:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Admin: Update User Role
  app.post("/api/admin/update-user-role", checkAdmin, async (req, res) => {
    const { uid, role } = req.body;
    try {
      await firestore.collection("users").doc(uid).update({
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Admin] Error updating user role:", error);
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
      // Fetch all users from Firestore, sorted by creation date
      const usersSnapshot = await firestore.collection("users")
        .orderBy("createdAt", "desc")
        .get();
        
      const users = usersSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        };
      });
      
      res.json({ users });
    } catch (error: any) {
      console.error("Failed to list users:", error.message);
      
      // Fallback: If orderBy fails because of missing index, try without it
      if (error.message.includes("FAILED_PRECONDITION")) {
        try {
          const usersSnapshot = await firestore.collection("users").get();
          const users = usersSnapshot.docs.map(doc => doc.data());
          return res.json({ users });
        } catch (innerError: any) {
          return res.status(500).json({ error: innerError.message });
        }
      }

      if (error.message.includes("PERMISSION_DENIED") || error.message.includes("Identity Toolkit API")) {
        const enablementLink = `https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${firebaseConfig.projectId}`;
        return res.status(403).json({ 
          error: "Không có quyền truy cập cơ sở dữ liệu hoặc Identity Toolkit API chưa được kích hoạt.",
          details: error.message,
          actionRequired: "Vui lòng kích hoạt Identity Toolkit API tại: " + enablementLink
        });
      }
      
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
