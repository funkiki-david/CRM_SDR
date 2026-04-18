/**
 * Root path — Auto redirect
 * If logged in → /dashboard, otherwise → /login
 */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      router.push("/dashboard");
    } else {
      router.push("/login");
    }
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <p className="text-gray-500">Redirecting...</p>
    </div>
  );
}
