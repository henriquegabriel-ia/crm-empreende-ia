import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ds/button";
import { Textarea } from "@/components/ds/textarea";
import { SidePanel } from "@/components/foundation/SidePanel";
import { StatusChip } from "@/components/foundation/StatusChip";
import { Bot, Send, Sparkles, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Msg = { role: "user" | "assistant"; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-copilot`;

const SUGGESTIONS = [
  "Quais pacientes estão agendados para hoje?",
  "Quais consultas ainda não foram confirmadas?",
  "Qual a taxa de no-show deste mês?",
  "Resuma o financeiro do mês",
  "Quais pacientes precisam de retorno?",
];

export function AICopilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();

  // Build page context
  const getContext = useCallback(() => {
    const path = location.pathname;
    if (path.startsWith("/patients/")) return `Usuário está na ficha do paciente (ID: ${path.split("/")[2]})`;
    if (path === "/patients") return "Usuário está na lista de pacientes";
    if (path === "/agenda") return "Usuário está na agenda de consultas";
    if (path === "/records") return "Usuário está nos prontuários";
    if (path === "/professionals") return "Usuário está na lista de profissionais";
    if (path === "/financeiro") return "Usuário está no financeiro";
    if (path === "/activities") return "Usuário está nas atividades/tarefas";
    if (path === "/pipeline") return "Usuário está no pipeline da jornada do paciente";
    if (path === "/reports") return "Usuário está nos relatórios";
    if (path === "/dashboard" || path === "/") return "Usuário está no dashboard principal da clínica";
    return `Usuário está na página ${path}`;
  }, [location.pathname]);

  // ⌘+J shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isLoading) return;

    const userMsg: Msg = { role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";
    const upsertAssistant = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          context: getContext(),
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        upsertAssistant(errData.error || "Erro ao processar. Tente novamente.");
        setIsLoading(false);
        return;
      }

      if (!resp.body) {
        upsertAssistant("Erro: resposta vazia");
        setIsLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (e) {
      console.error("AI Copilot error:", e);
      upsertAssistant("Erro de conexão. Verifique sua internet.");
    }

    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const userMsgCount = messages.filter((m) => m.role === "user").length;

  return (
    <>
      {/* Floating button */}
      <Button
        onClick={() => setOpen(true)}
        aria-label="Abrir AI Copilot (⌘+J)"
        className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full shadow-md bg-primary hover:bg-primary/90"
        size="icon"
      >
        <Sparkles className="h-5 w-5" />
      </Button>

      <SidePanel
        open={open}
        onOpenChange={setOpen}
        kicker="Assistente"
        title={
          <span className="flex items-center gap-2">
            AI Copilot
            {userMsgCount > 0 && (
              <StatusChip tone="neutral" dot={false}>{userMsgCount} msgs</StatusChip>
            )}
          </span>
        }
        description="⌘+J para abrir · Powered by Lovable AI"
        width="md"
        contentClassName="flex flex-col overflow-hidden p-0"
        footer={
          <div className="flex w-full items-end gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte algo sobre seus dados..."
              className="min-h-[36px] max-h-[80px] resize-none text-xs"
              rows={1}
            />
            <Button
              size="icon"
              aria-label="Enviar mensagem"
              className="h-9 w-9 shrink-0"
              onClick={() => sendMessage()}
              disabled={!input.trim() || isLoading}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      >
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4">
          <div className="py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-6">
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-3">Como posso ajudar?</p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage(s)}
                      className="text-xs px-2.5 py-1.5 rounded-full border border-border hover:bg-secondary/60 transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                    <Bot className="h-3 w-3 text-primary" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:m-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-xs">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/10 mt-0.5">
                    <User className="h-3 w-3" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                  <Bot className="h-3 w-3 text-primary" />
                </div>
                <div className="bg-muted rounded-lg px-3 py-2">
                  <span className="flex items-center gap-1" aria-label="Digitando…">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
                        style={{ animationDelay: `${i * 180}ms`, animationDuration: "900ms" }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </SidePanel>
    </>
  );
}
