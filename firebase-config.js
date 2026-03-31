// ============================================================
//  firebase-config.js — CNL PIP Platform 공유 Firebase 설정
//  모든 페이지에서 이 파일을 먼저 로드합니다.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs,
         addDoc, updateDoc, query, where, orderBy, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, listAll }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ── Firebase 초기화
const firebaseConfig = {
  apiKey:            "AIzaSyCvTjneXOadnoxpo6rdK9YfPh2O-eKbfvU",
  authDomain:        "cnl-pip.firebaseapp.com",
  projectId:         "cnl-pip",
  storageBucket:     "cnl-pip.firebasestorage.app",
  messagingSenderId: "230759792068",
  appId:             "1:230759792068:web:500cf7daa110bd2236f891"
};

const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// ── 역할별 리다이렉트 경로
const ROLE_REDIRECT = {
  admin:       'admin-dashboard.html',
  company:     'company-dashboard.html',
  participant: 'participant-dashboard.html',
  observer:    'participant-dashboard.html',
};

// ── 현재 로그인 사용자 정보 가져오기
async function getCurrentUser() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { resolve(null); return; }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          resolve({ uid: user.uid, email: user.email, ...snap.data() });
        } else {
          resolve({ uid: user.uid, email: user.email });
        }
      } catch(e) { resolve({ uid: user.uid, email: user.email }); }
    });
  });
}

// ── 페이지 인증 가드 (허용 역할 배열 전달)
async function requireAuth(allowedRoles) {
  const user = await getCurrentUser();
  if (!user) { window.location.href = 'index.html'; return null; }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    alert('접근 권한이 없습니다.');
    window.location.href = 'index.html';
    return null;
  }
  return user;
}

// ── 로그아웃
async function doLogout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  await signOut(auth);
  window.location.href = 'index.html';
}

export {
  auth, db, storage,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc,
  query, where, orderBy, serverTimestamp,
  ref, uploadBytes, getDownloadURL, listAll,
  ROLE_REDIRECT, getCurrentUser, requireAuth, doLogout
};
