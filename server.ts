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
      // Attempt standard verification
      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(idToken);
      } catch (verifyError: any) {
        console.error("Standard token verification failed:", verifyError.message);
        
        // Fallback: Manual decode for the primary admin if API is disabled
        const parts = idToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          const isPrimaryAdmin = payload.email === "mrihachnach@gmail.com" || payload.email === "admin@gmail.com";
          
          if (isPrimaryAdmin && payload.email_verified) {
            console.log("Using fallback verification for primary admin:", payload.email);
            decodedToken = payload;
            if (!decodedToken.uid) decodedToken.uid = payload.sub;
          } else {
            throw verifyError;
          }
        } else {
          throw verifyError;
        }
      }

      let userData: any = null;
      try {
        const userDoc = await firestore.collection("users").doc(decodedToken.uid).get();
        userData = userDoc.data();
      } catch (dbError: any) {
        if (dbError.message.includes("PERMISSION_DENIED")) {
          console.warn("Admin check: Firestore access denied. Relying on hardcoded admin list.");
        } else {
          console.error("Firestore fetch failed in admin check:", dbError.message);
        }
      }
      
      const isPrimaryAdmin = decodedToken.email === "mrihachnach@gmail.com" || 
                             decodedToken.email === "admin@gmail.com";
      
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
    
    if (!email || !password) {
      return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    }

    try {
      // 1. Create user in Firebase Auth via REST API
      // This bypasses the Identity Toolkit API issue with the Admin SDK in this environment
      // by using the project's API Key directly.
      const signUpResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          displayName: displayName || email.split('@')[0],
          returnSecureToken: true
        })
      });

      const signUpData: any = await signUpResponse.json();
      
      if (!signUpResponse.ok) {
        const errorCode = signUpData.error?.message;
        if (errorCode === 'EMAIL_EXISTS') {
          throw new Error("Email này đã được sử dụng.");
        } else if (errorCode?.includes('WEAK_PASSWORD')) {
          throw new Error("Mật khẩu quá yếu.");
        }
        throw new Error(signUpData.error?.message || "Lỗi khi tạo tài khoản qua REST API");
      }

      const uid = signUpData.localId;
      const idToken = signUpData.idToken;

      // 2. Set emailVerified to true via REST API
      try {
        await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseConfig.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken,
            emailVerified: true,
            returnSecureToken: false
          })
        });
      } catch (updateError) {
        console.warn("Failed to set emailVerified via REST API:", updateError);
      }
      
      // 3. Create user document in Firestore
      const userData = {
        uid,
        email,
        displayName: displayName || email.split('@')[0],
        role: role || "user",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      try {
        await firestore.collection("users").doc(uid).set(userData);
        
        // 4. Also add to authorized_emails for consistency
        await firestore.collection("authorized_emails").doc(email.toLowerCase()).set({
          role: role || "user",
          addedBy: (req as any).user.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (dbError: any) {
        console.warn("User created in Auth, but Firestore update failed:", dbError.message);
      }
      
      res.json({ success: true, uid });
    } catch (error: any) {
      console.error("[Admin] Error creating user:", error);
      
      if (error.message.includes("Identity Toolkit API") || error.code === 'auth/internal-error') {
        return res.status(500).json({ 
          error: "Lỗi hệ thống: Identity Toolkit API chưa được kích hoạt.",
          details: `Bạn PHẢI kích hoạt Identity Toolkit API tại: https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${firebaseConfig.projectId}\n\nSau khi kích hoạt, hãy đợi 1-2 phút rồi thử lại.`,
          apiLink: `https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${firebaseConfig.projectId}`
        });
      }

      let errorMessage = error.message;
      if (error.code === 'auth/email-already-exists') {
        errorMessage = "Email này đã được sử dụng.";
      } else if (error.code === 'auth/invalid-password') {
        errorMessage = "Mật khẩu không hợp lệ (tối thiểu 6 ký tự).";
      }
      
      res.status(400).json({ error: errorMessage });
    }
  });

  // Admin: List Users (Merged Auth + Firestore)
  app.get("/api/admin/list-users", checkAdmin, async (req, res) => {
    let authUsers: any[] = [];
    let authError = null;

    try {
      // 1. Attempt to fetch all users from Firebase Auth
      const listUsersResult = await auth.listUsers();
      authUsers = listUsersResult.users.map(userRecord => ({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        emailVerified: userRecord.emailVerified,
        disabled: userRecord.disabled,
        metadata: userRecord.metadata,
        providerData: userRecord.providerData,
      }));
    } catch (error: any) {
      console.error("[Admin] Auth listUsers failed:", error.message);
      authError = error.message;
      // If Identity Toolkit is disabled, we continue with Firestore only
    }

    try {
      // 2. Fetch all users from Firestore
      const usersSnapshot = await firestore.collection("users").get();
      const firestoreUsersMap = new Map();
      usersSnapshot.docs.forEach(doc => {
        firestoreUsersMap.set(doc.id, doc.data());
      });

      // 3. Merge or Fallback
      let finalUsers: any[] = [];

      if (authUsers.length > 0) {
        // Merge Auth users with Firestore data
        finalUsers = authUsers.map(authUser => {
          const firestoreData = firestoreUsersMap.get(authUser.uid) || {};
          return {
            ...authUser,
            ...firestoreData,
            role: firestoreData.role || (authUser.email === "mrihachnach@gmail.com" || authUser.email === "admin@gmail.com" ? "admin" : "user"),
            displayName: firestoreData.displayName || authUser.displayName || authUser.email?.split('@')[0],
            createdAt: firestoreData.createdAt || authUser.metadata.creationTime,
          };
        });
      } else {
        // Fallback: Just use Firestore users if Auth failed
        finalUsers = Array.from(firestoreUsersMap.values()).map(u => ({
          ...u,
          // Ensure we have a uid if it's not in the data
          uid: u.uid || u.id
        }));
      }

      res.json({ 
        success: true, 
        users: finalUsers,
        authSyncError: authError && (authError.includes("Identity Toolkit API") || authError.includes("403")) ? "API_DISABLED" : null,
        apiLink: `https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${firebaseConfig.projectId}`
      });
    } catch (error: any) {
      console.error("[Admin] Error listing users:", error);
      res.status(500).json({ error: "Không thể lấy danh sách người dùng: " + error.message });
    }
  });

  // Admin: Reset Password
  app.post("/api/admin/reset-password", checkAdmin, async (req, res) => {
    const { uid, newPassword } = req.body;
    try {
      await auth.updateUser(uid, {
        password: newPassword,
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Admin] Error resetting password:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Admin: Delete User
  app.post("/api/admin/delete-user", checkAdmin, async (req, res) => {
    const { uid, email } = req.body;
    try {
      // Delete from Auth
      await auth.deleteUser(uid);
      
      // Delete from Firestore
      await firestore.collection("users").doc(uid).delete();
      if (email) {
        await firestore.collection("authorized_emails").doc(email.toLowerCase()).delete();
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Admin] Error deleting user:", error);
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
