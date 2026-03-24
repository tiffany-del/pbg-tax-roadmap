import { useState } from "react";

const CORRECT = "2900";
const COOKIE_KEY = "pbg_auth";

function getCookie(name: string): string {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? match[2] : "";
}

function setCookie(name: string, value: string, days = 30) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${exp}; path=/; SameSite=Lax`;
}

export function isAuthenticated(): boolean {
  return getCookie(COOKIE_KEY) === "ok";
}

export function setAuthenticated() {
  setCookie(COOKIE_KEY, "ok");
}

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  const attempt = () => {
    if (value === CORRECT) {
      setAuthenticated();
      onSuccess();
    } else {
      setError(true);
      setValue("");
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#1b2951] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/pbg_logo_white.png"
            alt="Phillips Business Group"
            className="h-12 object-contain mx-auto mb-4"
            onError={e => {
              const img = e.target as HTMLImageElement;
              img.style.display = "none";
            }}
          />
          <h1 className="text-white text-2xl font-semibold" style={{ fontFamily: "serif" }}>
            Tax Roadmap Generator
          </h1>
          <p className="text-white/50 text-sm mt-1">Internal Tool · PBG Team</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <p className="text-[#1b2951] font-semibold mb-1 text-sm uppercase tracking-wide">
            Team Access
          </p>
          <p className="text-gray-500 text-sm mb-6">Enter your team password to continue.</p>

          <div className="space-y-4">
            <input
              type="password"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => e.key === "Enter" && attempt()}
              placeholder="Password"
              autoFocus
              className={`w-full border-2 rounded-lg px-4 py-3 text-lg tracking-widest outline-none transition-all ${
                error
                  ? "border-red-400 bg-red-50"
                  : "border-gray-200 focus:border-[#1b2951]"
              }`}
            />
            {error && (
              <p className="text-red-500 text-sm text-center">Incorrect password. Try again.</p>
            )}
            <button
              onClick={attempt}
              className="w-full bg-[#1b2951] hover:bg-[#1b2951]/90 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              Sign In
            </button>
          </div>
        </div>

        <p className="text-center text-white/30 text-xs mt-6">
          Phillips Business Group · 713-955-2900
        </p>
      </div>
    </div>
  );
}
