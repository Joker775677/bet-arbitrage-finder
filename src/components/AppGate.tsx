import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, X, Briefcase, Settings, User } from "lucide-react";

const STORAGE_KEY = "okak_auth_v1";
const LOGIN = "Joker";
const PASSWORD = "Kasper23267.1";

export function AppGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1") {
      setAuthed(true);
    }
    setReady(true);
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (login === LOGIN && password === PASSWORD) {
      localStorage.setItem(STORAGE_KEY, "1");
      setAuthed(true);
      setError("");
    } else {
      setError("Неверный логин или пароль");
    }
  };

  if (!ready) return null;
  if (authed) return <>{children}</>;

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{
        backgroundImage:
          "url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=80')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-md border border-[#5a4632] bg-[#1f1f1f]/95 shadow-2xl backdrop-blur-sm">
        {/* Title bar */}
        <div className="flex items-center justify-between bg-gradient-to-b from-[#8a6a3f] to-[#6b4f2c] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3a2a18] ring-1 ring-[#b08a55]">
              <User className="h-4 w-4 text-[#d4a574]" />
            </div>
            <span className="text-sm font-semibold tracking-widest">АВТОРИЗАЦИЯ</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="rounded p-1 hover:bg-white/10">
              <Briefcase className="h-4 w-4" />
            </button>
            <button type="button" className="rounded p-1 hover:bg-white/10">
              <Settings className="h-4 w-4" />
            </button>
            <button type="button" className="rounded p-1 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-7 py-6 text-[#e8e8e8]">
          <div className="text-center">
            <h2 className="text-base font-bold text-white">Добро пожаловать!</h2>
            <p className="mt-2 text-xs leading-relaxed text-[#b8b8b8]">
              Укажите данные необходимые для вашей идентификации. В случае необходимости свяжитесь с
              администрацией.
            </p>
          </div>

          {/* Login field */}
          <div className="relative rounded border border-[#4a4a4a] bg-[#2a2a2a] px-3 pb-2 pt-3">
            <label className="absolute -top-2 left-3 bg-[#1f1f1f] px-1 text-[10px] text-[#9a9a9a]">
              Ваш логин
            </label>
            <div className="flex items-center">
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoFocus
                className="w-full bg-transparent text-sm text-white outline-none"
              />
              {login && (
                <button
                  type="button"
                  onClick={() => setLogin("")}
                  className="text-[#9a9a9a] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Password field */}
          <div className="relative rounded border border-[#4a4a4a] bg-[#2a2a2a] px-3 pb-2 pt-3">
            <label className="absolute -top-2 left-3 bg-[#1f1f1f] px-1 text-[10px] text-[#9a9a9a]">
              Ваш пароль
            </label>
            <div className="flex items-center">
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent text-sm text-white outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="text-[#9a9a9a] hover:text-white"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && <p className="text-center text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            className="w-full rounded bg-gradient-to-b from-[#8a6a3f] to-[#6b4f2c] py-2.5 text-sm font-semibold text-white shadow-md transition hover:from-[#9a7a4f] hover:to-[#7b5f3c]"
          >
            Вход
          </button>
        </form>
      </div>
    </div>
  );
}
