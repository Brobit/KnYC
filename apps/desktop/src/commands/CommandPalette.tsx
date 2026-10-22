// The command palette (⌘K / Ctrl+K): every registered command, by group, with its shortcut, and a
// "Go to file" mode (⌘P / Ctrl+P) over the open folder.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { fileIcon } from "@/explorer/file-icons";
import { nameOf } from "@/explorer/tree";
import { useWorkspace } from "@/workspace/workspace-context";
import { formatShortcut, GROUPS, useCommands, useRegisterCommands, type Command as AppCommand } from "./commands";

type Mode = "commands" | "files";

export function CommandPalette() {
  const { t } = useTranslation();
  const { registry, run, showWorkspace } = useCommands();
  const { folder, fs, openFile } = useWorkspace();
  const commands = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("commands");
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<string[] | null>(null);
  // After running something, focus stays where the command put it instead of going back.
  const ran = useRef(false);

  const show = (next: Mode) => {
    setMode(next);
    setSearch("");
    setOpen(true);
  };

  useRegisterCommands(
    () => [
      { id: "palette.open", title: t("commands.palette"), group: "app", shortcuts: ["Mod+K", "Mod+Shift+P"], run: () => (open && mode === "commands" ? setOpen(false) : show("commands")) },
      ...(folder ? [{ id: "file.goTo", title: t("commands.goToFile"), group: "file" as const, shortcuts: ["Mod+P"], run: () => show("files") }] : []),
    ],
    [t, folder],
  );

  // The file list is read each time "Go to file" opens, so it follows the disk.
  useEffect(() => {
    if (!open || mode !== "files" || !folder) return;
    let live = true;
    setFiles(null);
    fs.tree().then(
      (entries) => live && setFiles(entries.filter((e) => e.kind === "file").map((e) => e.path).sort()),
      () => live && setFiles([]),
    );
    return () => {
      live = false;
    };
  }, [open, mode, folder, fs]);

  const pick = (action: () => void) => {
    ran.current = true;
    setOpen(false);
    action();
  };

  const listed = commands.filter((c) => c.id !== "palette.open");
  const byGroup = GROUPS.map((group) => [group, listed.filter((c) => c.group === group).sort((a, b) => a.title.localeCompare(b.title))] as const);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] translate-y-0 gap-0 overflow-hidden border-border bg-surface p-0 sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          if (ran.current) event.preventDefault();
          ran.current = false;
        }}
      >
        <DialogTitle className="sr-only">{t(mode === "files" ? "commands.goToFile" : "commands.palette")}</DialogTitle>
        <DialogDescription className="sr-only">{t(mode === "files" ? "commands.filesHint" : "commands.hint")}</DialogDescription>
        <Command loop className="bg-surface">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={t(mode === "files" ? "commands.filesPlaceholder" : "commands.placeholder")}
            onKeyDown={(e) => {
              // Backspace on an empty "Go to file" goes back to the commands.
              if (mode === "files" && e.key === "Backspace" && !search) setMode("commands");
            }}
          />
          <CommandList className="max-h-[min(420px,60vh)]">
            <CommandEmpty className="py-6 text-center text-[13px] text-text-muted">
              {mode === "files" && files === null ? t("commands.loadingFiles") : t("commands.none")}
            </CommandEmpty>
            {mode === "commands" &&
              byGroup.map(
                ([group, items]) =>
                  items.length > 0 && (
                    <CommandGroup key={group} heading={t(`commands.groups.${group}`)}>
                      {items.map((command) => (
                        <CommandRow key={command.id} command={command} onSelect={() => pick(() => run(command))} />
                      ))}
                    </CommandGroup>
                  ),
              )}
            {mode === "files" && files && files.length > 0 && (
              <CommandGroup heading={folder?.name}>
                {files.map((path) => {
                  const Icon = fileIcon({ kind: "file" }, nameOf(path));
                  return (
                    <CommandItem
                      key={path}
                      value={path}
                      className="text-[13px]"
                      onSelect={() =>
                        pick(() => {
                          showWorkspace();
                          openFile(path);
                        })
                      }
                    >
                      <Icon aria-hidden />
                      <span className="truncate">{nameOf(path)}</span>
                      <span className="truncate text-xs text-text-muted">{path}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandRow({ command, onSelect }: { command: AppCommand; onSelect: () => void }) {
  const shortcut = command.shortcuts?.[0];
  return (
    <CommandItem value={command.id} keywords={[command.title]} className="text-[13px]" onSelect={onSelect}>
      <span className="truncate">{command.title}</span>
      {shortcut && (
        <CommandShortcut>
          <kbd className="font-sans tracking-normal">{formatShortcut(shortcut)}</kbd>
        </CommandShortcut>
      )}
    </CommandItem>
  );
}
