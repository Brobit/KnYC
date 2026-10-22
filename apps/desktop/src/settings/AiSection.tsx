// Settings → AI providers (knyc.pen "Screen · Settings"): who KnYC may ask, and which model does what.
import { Cpu, KeyRound, Plug, Plus, RefreshCw, SquareTerminal, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "@knyc/core/schemas";
import { StatusBadge } from "@/components/knyc/badges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { API_PROVIDERS, keyRefFor, MODEL_SUGGESTIONS, OLLAMA_DEFAULT_URL, ROLES, withoutProvider, withProvider, type RoleId } from "./providers";
import type { ClaudeCliStatus, SettingsBackend } from "./settings-backend";

export const selectClass =
  "h-[30px] w-full rounded-md border border-border-strong bg-surface px-2 text-[12px] text-text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function isHttpUrl(text: string) {
  try {
    return ["http:", "https:"].includes(new URL(text).protocol);
  } catch {
    return false;
  }
}

function ProviderRow({ icon, name, kind, detail, detailTone = "muted", status, actions, children }: {
  icon: ReactNode;
  name: string;
  kind: string;
  detail?: ReactNode;
  detailTone?: "muted" | "warning" | "danger";
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0" aria-label={name}>
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-text-secondary [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold text-text-primary">{name}</span>
            <span className="text-[11px] text-text-muted">{kind}</span>
          </div>
          {detail && (
            <span
              className={cn(
                "truncate font-mono text-[11px]",
                detailTone === "warning" ? "text-warning" : detailTone === "danger" ? "text-danger" : "text-text-muted",
              )}
            >
              {detail}
            </span>
          )}
        </div>
        {status}
        {actions}
      </div>
      {children}
    </li>
  );
}

function Dot({ tone, children }: { tone: "success" | "warning"; children: ReactNode }) {
  return (
    <span className={cn("flex items-center gap-1.5 text-xs", tone === "success" ? "text-success" : "text-warning")}>
      <span className={cn("size-[7px] rounded-full", tone === "success" ? "bg-success" : "bg-warning")} aria-hidden />
      {children}
    </span>
  );
}

function ApiKeyRow({ type, label, placeholder, backend }: (typeof API_PROVIDERS)[number] & { backend: SettingsBackend }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const keyRef = keyRefFor(type);
  const [hint, setHint] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let live = true;
    backend.keyHint(keyRef).then(
      (h) => live && setHint(h),
      (e) => live && (setHint(null), setError(errorText(e))),
    );
    return () => {
      live = false;
    };
  }, [backend, keyRef]);

  // A key counts only when it is in the keychain and the provider is in settings.json.
  const connected = !!hint && settings.providers.some((p) => p.id === type);

  async function save() {
    try {
      const saved = await backend.saveKey(keyRef, draft);
      update((s) => withProvider(s, { id: type, type, label, keyRef }));
      setHint(saved);
      setEditing(false);
      setDraft("");
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove() {
    try {
      await backend.deleteKey(keyRef);
      update((s) => withoutProvider(s, type));
      setHint(null);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const cancel = () => {
    setEditing(false);
    setDraft("");
    setError(null);
  };

  return (
    <ProviderRow
      icon={<KeyRound />}
      name={label}
      kind={t("settings.ai.apiKey")}
      detail={error ?? (connected ? hint : undefined)}
      detailTone={error ? "danger" : "muted"}
      status={connected && <Dot tone="success">{t("settings.ai.connected")}</Dot>}
      actions={
        !editing &&
        hint !== undefined &&
        (connected ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              {t("settings.ai.replaceKey")}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("settings.ai.removeKeyNamed", { name: label })} onClick={() => setConfirmRemove(true)}>
              <Trash2 />
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Plus />
            {t("settings.ai.addKey")}
          </Button>
        ))
      }
    >
      {editing && (
        <form
          className="flex items-center gap-2 pl-11"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            type="password"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="h-[30px] font-mono text-xs"
            placeholder={placeholder}
            aria-label={t("settings.ai.keyFor", { name: label })}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && cancel()}
          />
          <Button type="submit" disabled={!draft.trim()}>
            {t("settings.save")}
          </Button>
          <Button type="button" variant="ghost" onClick={cancel}>
            {t("settings.cancel")}
          </Button>
        </form>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.ai.removeKeyTitle", { name: label })}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.ai.removeKeyBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              {t("settings.ai.removeKey")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProviderRow>
  );
}

function OllamaRow() {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const provider = settings.providers.find((p) => p.type === "ollama");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const valid = isHttpUrl(draft.trim());

  const edit = () => {
    setDraft(provider?.baseUrl ?? OLLAMA_DEFAULT_URL);
    setEditing(true);
  };
  const save = () => {
    update((s) => withProvider(s, { id: provider?.id ?? "ollama", type: "ollama", label: "Ollama", baseUrl: draft.trim() }));
    setEditing(false);
  };

  return (
    <ProviderRow
      icon={<Cpu />}
      name="Ollama"
      kind={t("settings.ai.localModels")}
      detail={provider?.baseUrl}
      actions={
        !editing &&
        (provider ? (
          <>
            <Button variant="ghost" onClick={edit}>
              {t("settings.ai.edit")}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={t("settings.ai.removeNamed", { name: "Ollama" })} onClick={() => update((s) => withoutProvider(s, provider.id))}>
              <Trash2 />
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={edit}>
            <Plus />
            {t("settings.ai.add")}
          </Button>
        ))
      }
    >
      {editing && (
        <form
          className="flex items-center gap-2 pl-11"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save();
          }}
        >
          <Input
            autoFocus
            spellCheck={false}
            className="h-[30px] font-mono text-xs"
            aria-label={t("settings.ai.ollamaUrl")}
            aria-invalid={!valid}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          />
          <Button type="submit" disabled={!valid}>
            {t("settings.save")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            {t("settings.cancel")}
          </Button>
        </form>
      )}
    </ProviderRow>
  );
}

function ClaudeCliRow({ backend }: { backend: SettingsBackend }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  const [status, setStatus] = useState<ClaudeCliStatus | null>(null);
  const [check, setCheck] = useState(0);
  const enabled = settings.providers.some((p) => p.id === "claude-cli");

  useEffect(() => {
    let live = true;
    setStatus(null);
    backend.claudeCli().then(
      (s) => live && setStatus(s),
      () => live && setStatus({ path: null, version: null, loggedIn: null }),
    );
    return () => {
      live = false;
    };
  }, [backend, check]);

  let detail: string;
  let tone: "muted" | "warning" = "muted";
  if (!status) detail = t("settings.ai.cliChecking");
  else if (!status.path) {
    detail = t("settings.ai.cliMissing");
    tone = "warning";
  } else if (status.loggedIn === false) {
    detail = t("settings.ai.cliLoggedOut", { version: status.version ?? "?" });
    tone = "warning";
  } else detail = t("settings.ai.cliDetected", { version: status.version ?? "?" });

  const toggle = () =>
    update((s) => (enabled ? withoutProvider(s, "claude-cli") : withProvider(s, { id: "claude-cli", type: "claude-cli", label: "Claude Code" })));

  return (
    <ProviderRow
      icon={<SquareTerminal />}
      name="Claude Code"
      kind={t("settings.ai.localCli")}
      detail={detail}
      detailTone={tone}
      status={
        <>
          {status?.path && status.loggedIn !== false && <Dot tone="success">{t("settings.ai.detected")}</Dot>}
          <span title={t("settings.ai.termsHint")}>
            <StatusBadge tone="warning" icon={<TriangleAlert />}>
              {t("settings.ai.checkTerms")}
            </StatusBadge>
          </span>
        </>
      }
      actions={
        <>
          <Button variant="ghost" size="icon-sm" aria-label={t("settings.ai.checkAgain")} title={t("settings.ai.checkAgain")} onClick={() => setCheck((n) => n + 1)}>
            <RefreshCw />
          </Button>
          <Button variant="ghost" onClick={toggle} aria-pressed={enabled}>
            <Plug />
            {enabled ? t("settings.ai.disable") : t("settings.ai.enable")}
          </Button>
        </>
      }
    />
  );
}

function RoleCard({ role }: { role: RoleId }) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();
  // A draft, saved only once complete: an empty model would make settings.json invalid.
  const [draft, setDraft] = useState<Settings["roles"][RoleId]>(settings.roles[role]);
  const { providerId, model } = draft;
  const listId = useId();
  const selectId = useId();
  const provider = settings.providers.find((p) => p.id === providerId);
  const suggestions = (provider && MODEL_SUGGESTIONS[provider.type]) ?? [];

  const change = (next: Settings["roles"][RoleId]) => {
    setDraft(next);
    if (next.model.trim()) update((s) => ({ ...s, roles: { ...s.roles, [role]: { providerId: next.providerId, model: next.model.trim() } } }));
  };

  const pickProvider = (id: string) => {
    const type = settings.providers.find((p) => p.id === id)?.type;
    change({ providerId: id, model: (type && MODEL_SUGGESTIONS[type]?.[0]) ?? "" });
  };

  return (
    <section className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-4" aria-labelledby={`${selectId}-title`}>
      <h3 id={`${selectId}-title`} className="text-[13px] font-semibold text-text-primary">
        {t(`settings.roles.${role}`)}
      </h3>
      <p className="text-xs text-text-muted">{t(`settings.roles.${role}Hint`)}</p>
      <label className="sr-only" htmlFor={selectId}>
        {t("settings.roles.provider")}
      </label>
      <select id={selectId} className={selectClass} value={providerId} onChange={(e) => pickProvider(e.target.value)}>
        {!provider && <option value={providerId}>{t("settings.roles.missingOption", { id: providerId })}</option>}
        {settings.providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <Input
        className="h-[30px] font-mono text-xs"
        aria-label={t("settings.roles.model")}
        aria-invalid={!model.trim()}
        list={listId}
        value={model}
        onChange={(e) => change({ providerId, model: e.target.value })}
      />
      <datalist id={listId}>
        {suggestions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {!provider && <p className="text-xs text-warning">{t("settings.roles.missing")}</p>}
      {!model.trim() && <p className="text-xs text-danger">{t("settings.roles.modelRequired")}</p>}
    </section>
  );
}

export function AiSection({ backend }: { backend: SettingsBackend }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <ul className="overflow-hidden rounded-[10px] border border-border bg-surface" aria-label={t("settings.sections.ai")}>
        {API_PROVIDERS.map((p) => (
          <ApiKeyRow key={p.type} {...p} backend={backend} />
        ))}
        <OllamaRow />
        <ClaudeCliRow backend={backend} />
      </ul>
      <div className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold text-text-primary">{t("settings.roles.title")}</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {ROLES.map((role) => (
            <RoleCard key={role} role={role} />
          ))}
        </div>
      </div>
    </div>
  );
}
