import { useEffect, useState, type FormEvent } from "react";

const STORAGE_KEY = "okak_auth_v1";
const LOGIN = "Joker";
const PASSWORD = "Kasper23267.1";

export function AppGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-lg"
      >
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold text-foreground">Okak</h1>
          <p className="text-sm text-muted-foreground">Введите логин и пароль для входа</p>
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">Логин</label>
          <input
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoFocus
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Войти
        </button>
      </form>
    </div>
  );
}
