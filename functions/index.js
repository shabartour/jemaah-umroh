const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { GoogleAuth } = require("google-auth-library");

initializeApp();
const adminAuth = getAuth();
const adminDb = getFirestore();

const REGION = process.env.FUNCTION_REGION || "asia-southeast1";

// Document AI can live in a different Google Cloud project from Firebase.
const DEFAULT_PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
const DOCUMENT_AI_PROJECT_ID = process.env.DOCUMENT_AI_PROJECT_ID || DEFAULT_PROJECT_ID;
const DOCUMENT_AI_LOCATION = process.env.DOCUMENT_AI_LOCATION || "asia-southeast1";
const DOCUMENT_AI_PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || "";

// Vertex AI project and location are configurable independently from Document AI.
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || DEFAULT_PROJECT_ID;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "asia-southeast1";

// Gemini 2.5 Flash was retired in October 2026. Gemini 3.5 Flash is GA,
// supports structured output, and is available in asia-southeast1.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

const responseSchema = {
  type: "OBJECT",
  properties: {
    nik: { type: "STRING" },
    nama: { type: "STRING" },
    tempatLahir: { type: "STRING" },
    tanggalLahir: { type: "STRING" },
    jenisKelamin: { type: "STRING" },
    alamat: { type: "STRING" },
    rtRw: { type: "STRING" },
    desaKelurahan: { type: "STRING" },
    kecamatan: { type: "STRING" },
    kabupatenKota: { type: "STRING" },
    provinsi: { type: "STRING" }
  },
  required: [
    "nik", "nama", "tempatLahir", "tanggalLahir", "jenisKelamin",
    "alamat", "rtRw", "desaKelurahan", "kecamatan", "kabupatenKota", "provinsi"
  ]
};

function clean(value, max = 180) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizedRole(profile) {
  return String(profile?.role || "").trim().toLowerCase();
}

function isProfileActive(profile) {
  return profile?.aktif === true;
}

async function requireActiveStaff(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Silakan login terlebih dahulu.");
  }
  const snapshot = await adminDb.collection("users").doc(request.auth.uid).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || !isProfileActive(profile) || !["admin", "staff"].includes(normalizedRole(profile))) {
    throw new HttpsError("permission-denied", "Akun tidak aktif atau tidak memiliki hak akses Staff.");
  }
  return profile;
}

async function requireAdmin(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Silakan login terlebih dahulu.");
  }
  const snapshot = await adminDb.collection("users").doc(request.auth.uid).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || !isProfileActive(profile) || normalizedRole(profile) !== "admin") {
    throw new HttpsError("permission-denied", "Fitur ini hanya dapat digunakan oleh Admin aktif.");
  }
  return profile;
}

function normalizeKtpFields(data) {
  const result = {};
  for (const key of Object.keys(responseSchema.properties)) result[key] = clean(data?.[key], key === "alamat" ? 300 : 180);

  const nik = result.nik.replace(/\D/g, "");
  result.nik = nik.length === 16 ? nik : "";

  const date = result.tanggalLahir.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!date) {
    result.tanggalLahir = "";
  } else {
    const year = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || year < 1900 || year > new Date().getFullYear()) result.tanggalLahir = "";
  }

  const gender = result.jenisKelamin.toLocaleLowerCase("id-ID");
  if (gender.includes("perempuan") || gender === "p") result.jenisKelamin = "Perempuan";
  else if (gender.includes("laki") || gender === "l") result.jenisKelamin = "Laki-laki";
  else result.jenisKelamin = "";

  return result;
}

async function googleFetch(url, options = {}) {
  const client = await googleAuth.getClient();
  const accessTokenResult = await client.getAccessToken();
  const accessToken = typeof accessTokenResult === "string" ? accessTokenResult : accessTokenResult?.token;
  if (!accessToken) throw new Error("Tidak dapat memperoleh kredensial layanan Google Cloud.");
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const bodyText = await response.text();
  let body = {};
  try { body = bodyText ? JSON.parse(bodyText) : {}; } catch (_) { body = { raw: bodyText.slice(0, 500) }; }
  if (!response.ok) {
    const detail = body?.error?.message || `Google API mengembalikan HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

exports.scanKtpDocument = onCall({
  region: REGION,
  timeoutSeconds: 90,
  memory: "512MiB",
  maxInstances: 3,
  enforceAppCheck: false
}, async (request) => {
  await requireActiveStaff(request);

  if (!DOCUMENT_AI_PROJECT_ID || !DOCUMENT_AI_PROCESSOR_ID) {
    throw new HttpsError(
      "failed-precondition",
      "Konfigurasi OCR belum lengkap. Atur DOCUMENT_AI_PROJECT_ID dan DOCUMENT_AI_PROCESSOR_ID pada GitHub Actions Variables, lalu deploy ulang."
    );
  }
  if (!VERTEX_PROJECT_ID) {
    throw new HttpsError("failed-precondition", "Konfigurasi Vertex AI belum lengkap. Atur VERTEX_PROJECT_ID lalu deploy ulang.");
  }

  const mimeType = clean(request.data?.mimeType, 40).toLowerCase();
  if (!["image/jpeg", "image/png"].includes(mimeType)) {
    throw new HttpsError("invalid-argument", "Format foto harus JPG atau PNG.");
  }
  const imageBase64 = String(request.data?.imageBase64 || "").replace(/^data:image\/(?:jpeg|png);base64,/i, "");
  if (!imageBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw new HttpsError("invalid-argument", "Data foto KTP tidak valid.");
  }
  const imageBuffer = Buffer.from(imageBase64, "base64");
  if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_BYTES) {
    throw new HttpsError("invalid-argument", "Ukuran foto setelah kompresi harus maksimal 6 MB.");
  }

  try {
    // Tahap 1: Document AI OCR. Foto dikirim langsung ke processor dan tidak disimpan ke Cloud Storage.
    const processorName = `projects/${DOCUMENT_AI_PROJECT_ID}/locations/${DOCUMENT_AI_LOCATION}/processors/${DOCUMENT_AI_PROCESSOR_ID}`;
    const documentUrl = `https://${DOCUMENT_AI_LOCATION}-documentai.googleapis.com/v1/${processorName}:process`;
    const ocrResponse = await googleFetch(documentUrl, {
      method: "POST",
      body: JSON.stringify({ rawDocument: { content: imageBuffer.toString("base64"), mimeType } })
    });
    const ocrText = String(ocrResponse?.document?.text || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
    if (ocrText.length < 20) throw new HttpsError("data-loss", "Tulisan KTP belum terbaca. Coba foto yang lebih terang, lurus, dan tidak terpotong.");

    // Tahap 2: Gemini pada Vertex AI hanya menerima teks hasil OCR, bukan foto KTP.
    const prompt = [
      "Ekstrak data dari teks OCR KTP elektronik Indonesia berikut.",
      "Kembalikan hanya nilai yang benar-benar tertulis atau dapat dipastikan dari teks.",
      "Jangan menebak, melengkapi, atau menyimpulkan alamat dari NIK.",
      "Jika suatu field tidak terbaca atau meragukan, isi string kosong.",
      "NIK harus 16 digit. tanggalLahir harus YYYY-MM-DD. jenisKelamin hanya Laki-laki atau Perempuan.",
      "Pertahankan nama wilayah sesuai teks KTP; jangan mengganti dengan nama wilayah lain.",
      "Pisahkan RT/RW ke field rtRw jika terbaca.",
      "",
      "TEKS OCR KTP:",
      ocrText
    ].join("\n");
    const vertexUrl = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;
    const geminiResponse = await googleFetch(vertexUrl, {
      method: "POST",
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema
        }
      })
    });
    const answerText = (geminiResponse?.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("").trim();
    if (!answerText) throw new Error("Gemini tidak mengembalikan data terstruktur.");
    let parsed;
    try { parsed = JSON.parse(answerText); }
    catch (_) { throw new Error("Format jawaban AI tidak valid. Silakan pindai ulang."); }

    const fields = normalizeKtpFields(parsed);
    const filledCount = Object.values(fields).filter(Boolean).length;
    if (!filledCount) throw new HttpsError("data-loss", "Data KTP belum berhasil diekstrak. Coba foto yang lebih jelas.");
    return { fields, provider: "document-ai+vertex-gemini", model: GEMINI_MODEL, ocrCharacters: ocrText.length };
  } catch (error) {
    console.error("scanKtpDocument failed", { code: error.code || "unknown", message: error.message });
    if (error instanceof HttpsError) throw error;
    const message = /PERMISSION_DENIED|permission/i.test(error.message)
      ? "Akun layanan belum memiliki izin Document AI atau Vertex AI. Periksa IAM pada Google Cloud."
      : /NOT_FOUND|not found/i.test(error.message)
        ? "Processor Document AI atau model Gemini tidak ditemukan. Periksa ID processor dan lokasi layanan."
        : "Pemindaian AI gagal. Periksa konfigurasi Google Cloud lalu coba kembali.";
    throw new HttpsError("internal", message);
  }
});


/**
 * Admin-only user provisioning. Firebase Admin SDK creates accounts
 * without replacing the Admin's browser authentication session.
 * Admin role assignment remains a manual bootstrap operation.
 */
exports.adminCreateUser = onCall({
  region: REGION,
  enforceAppCheck: false
}, async (request) => {
  await requireAdmin(request);

  const nama = clean(request.data?.nama, 100);
  const email = clean(request.data?.email, 254).toLowerCase();
  const password = String(request.data?.password || "");
  const roleInput = String(request.data?.role || "").trim().toLowerCase();
  const role = roleInput === "staff" ? "Staff" : roleInput === "viewer" ? "Viewer" : "";

  if (!nama) throw new HttpsError("invalid-argument", "Nama pengguna wajib diisi.");
  const emailParts = email.split("@");
  if (emailParts.length !== 2 || !emailParts[0] || !emailParts[1].includes(".") || email.includes(" ")) {
    throw new HttpsError("invalid-argument", "Format email tidak valid.");
  }
  if (password.length < 10) {
    throw new HttpsError("invalid-argument", "Password awal minimal 10 karakter.");
  }
  if (!role) {
    throw new HttpsError("invalid-argument", "Role akun hanya boleh Staff atau Viewer.");
  }

  let createdUser;
  try {
    createdUser = await adminAuth.createUser({ email, password, displayName: nama, disabled: false });
    await adminDb.collection("users").doc(createdUser.uid).create({
      nama,
      email,
      role,
      aktif: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.uid
    });
    return { uid: createdUser.uid, email, role };
  } catch (error) {
    if (createdUser?.uid) {
      await adminAuth.deleteUser(createdUser.uid).catch(rollbackError => {
        console.error("Rollback user Auth gagal:", rollbackError.message);
      });
    }
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Email sudah terdaftar di Firebase Authentication.");
    }
    console.error("adminCreateUser failed:", error);
    throw new HttpsError("internal", "Akun gagal dibuat. Periksa log Cloud Functions.");
  }
});

exports.adminSetUserActive = onCall({
  region: REGION,
  enforceAppCheck: false
}, async (request) => {
  await requireAdmin(request);
  const uid = clean(request.data?.uid, 128);
  const aktif = request.data?.aktif;
  if (!uid || typeof aktif !== "boolean") {
    throw new HttpsError("invalid-argument", "UID dan status aktif tidak valid.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "Admin tidak dapat menonaktifkan akunnya sendiri.");
  }

  const userRef = adminDb.collection("users").doc(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Profil pengguna tidak ditemukan.");
  if (normalizedRole(snapshot.data()) === "admin") {
    throw new HttpsError("failed-precondition", "Akun Admin tidak dapat dinonaktifkan dari menu ini.");
  }

  try {
    if (aktif) {
      await adminAuth.updateUser(uid, { disabled: false });
      await userRef.update({ aktif: true, updatedAt: FieldValue.serverTimestamp() });
    } else {
      // Tutup akses Firestore terlebih dahulu agar token/sesi lama langsung ditolak Rules.
      await userRef.update({ aktif: false, updatedAt: FieldValue.serverTimestamp() });
      await adminAuth.updateUser(uid, { disabled: true });
    }
    return { uid, aktif };
  } catch (error) {
    console.error("adminSetUserActive failed:", error);
    throw new HttpsError("internal", "Status akun gagal diperbarui. Periksa log Cloud Functions.");
  }
});

exports.adminDeleteUser = onCall({
  region: REGION,
  enforceAppCheck: false
}, async (request) => {
  await requireAdmin(request);
  const uid = clean(request.data?.uid, 128);
  if (!uid) throw new HttpsError("invalid-argument", "UID pengguna wajib diisi.");
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "Admin tidak dapat menghapus akunnya sendiri.");
  }

  const userRef = adminDb.collection("users").doc(uid);
  const snapshot = await userRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Profil pengguna tidak ditemukan.");
  if (normalizedRole(snapshot.data()) === "admin") {
    throw new HttpsError("failed-precondition", "Akun Admin tidak dapat dihapus dari menu ini.");
  }

  // Profile dikunci dahulu; jika hapus Auth gagal, akses Firestore tetap tertutup.
  await userRef.update({ aktif: false, updatedAt: FieldValue.serverTimestamp() });
  try {
    await adminAuth.deleteUser(uid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      console.error("adminDeleteUser Auth delete failed:", error);
      throw new HttpsError("internal", "Akun sudah dikunci di Firestore, tetapi penghapusan Authentication gagal.");
    }
  }
  await userRef.delete();
  return { uid, deleted: true };
});
