import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Briefcase, Settings as SettingsIcon, X } from "lucide-react";

export const Route = createFileRoute("/browser")({
  head: () => ({
    meta: [{ title: "Двойной браузер" }],
  }),
  component: DualBrowserPage,
});

interface PanelProps {
  initialUrl: string;
  title?: string;
}

function normalizeUrl(input: string): string {
  const v = input.trim();
  if (!v) return "about:blank";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+/.test(v)) return `https://${v}`;
  return `https://www.google.com/search?q=${encodeURIComponent(v)}`;
}

function BrowserPanel({ initialUrl, title = "Common" }: PanelProps) {
  const [url, setUrl] = useState(initialUrl);
  const [addressValue, setAddressValue] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const navigate = (next: string) => {
    const u = normalizeUrl(next);
    setUrl(u);
    setAddressValue(u);
    const trimmed = history.slice(0, historyIndex + 1);
    trimmed.push(u);
    setHistory(trimmed);
    setHistoryIndex(trimmed.length - 1);
  };

  const goBack = () => {
    if (historyIndex <= 0) return;
    const i = historyIndex - 1;
    setHistoryIndex(i);
    setUrl(history[i]);
    setAddressValue(history[i]);
  };

  const goForward = () => {
    if (historyIndex >= history.length - 1) return;
    const i = historyIndex + 1;
    setHistoryIndex(i);
    setUrl(history[i]);
    setAddressValue(history[i]);
  };

  const reload = () => {
    if (iframeRef.current) {
      // force reload by resetting src
      const cur = url;
      iframeRef.current.src = "about:blank";
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = cur;
      }, 30);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    navigate(addressValue);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden border border-[#3a3a3a] bg-[#1a1a1a]">
      {/* Title bar */}
      <div className="flex items-center justify-between bg-gradient-to-b from-[#3a3a3a] to-[#2a2a2a] px-2 py-1 text-[11px] text-[#d4d4d4]">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{title}</span>
        </div>
        <div className="flex items-center gap-2 text-[#9a9a9a]">
          <span>Режим вкладок</span>
          <Briefcase className="h-3 w-3" />
          <SettingsIcon className="h-3 w-3" />
          <span className="text-[#d4a574]">БК</span>
          <span className="text-[#d4a574]">Вилки</span>
          <X className="h-3 w-3" />
        </div>
      </div>

      {/* Address bar */}
      <div className="flex items-center gap-1 border-b border-[#3a3a3a] bg-[#222] px-2 py-1">
        <button
          type="button"
          onClick={goBack}
          disabled={historyIndex <= 0}
          className="rounded p-1 text-[#bbb] hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          className="rounded p-1 text-[#bbb] hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={reload} className="rounded p-1 text-[#bbb] hover:bg-white/10">
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <form onSubmit={onSubmit} className="flex-1">
          <input
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            className="w-full rounded border border-[#3a3a3a] bg-[#2c2c2c] px-2 py-1 text-xs text-white outline-none focus:border-[#8a6a3f]"
          />
        </form>
        <span className="px-1 text-[10px] text-[#9a9a9a]">Закладки</span>
      </div>

      {/* Iframe */}
      <div className="relative flex-1 bg-black">
        <iframe
          ref={iframeRef}
          src={url === "about:blank" ? url : `/api/public/proxy?url=${encodeURIComponent(url)}`}
          title={title}
          className="h-full w-full border-0 bg-white"
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
        />
      </div>
    </div>
  );
}

function DualBrowserPage() {
  return (
    <div className="flex h-[calc(100vh-0px)] flex-col gap-1 bg-[#0d0d0d] p-1">
      <div className="min-h-0 flex-1">
        <BrowserPanel initialUrl="https://vk.com/theforks_ru" title="Common — 1" />
      </div>
      <div className="min-h-0 flex-1">
        <BrowserPanel initialUrl="https://theforks.ru/" title="Common — 2" />
      </div>
    </div>
  );
}
