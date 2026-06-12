import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { searchClients, updateClient } from "@/shared/api/clients";
import type { Client } from "@/shared/api/types";
import { formatPhone } from "@/shared/lib/format";
import { useDebounced } from "@/shared/lib/useDebounced";
import { Button, EmptyState, ErrorText, Field, Input, Modal, Spinner, Textarea } from "@/shared/ui";
import { useAuth } from "@/app/AuthProvider";

export function ClientsPage() {
  const { profile } = useAuth();
  const canEdit = profile?.role !== "master";
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const [editing, setEditing] = useState<Client | null>(null);

  const clients = useQuery({
    queryKey: ["clients", debounced],
    queryFn: () => searchClients(debounced, 50),
  });

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-bold">Клиенты</h1>
      <Input
        placeholder="Поиск по имени или телефону…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {clients.isLoading ? (
        <Spinner />
      ) : clients.data && clients.data.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {clients.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted">
                  {formatPhone(c.phone)}
                  {c.email && ` · ${c.email}`}
                  {c.telegram_chat_id && " · TG ✓"}
                </p>
                {c.comment && <p className="truncate text-xs text-muted">{c.comment}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Link
                  to={`/orders?client=${c.id}`}
                  className="rounded-lg bg-surface-2 border border-border px-3 py-1.5 text-xs text-muted hover:text-text"
                >
                  Заказы
                </Link>
                {canEdit && (
                  <button
                    onClick={() => setEditing(c)}
                    className="rounded-lg bg-surface-2 border border-border px-3 py-1.5 text-xs text-muted hover:text-text"
                  >
                    Изменить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="Клиенты не найдены" />
      )}

      {editing && <EditClientModal client={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditClientModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(client.name);
  const [phone, setPhone] = useState(client.phone_display ?? client.phone);
  const [messenger, setMessenger] = useState(client.messenger ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [comment, setComment] = useState(client.comment ?? "");

  const save = useMutation({
    mutationFn: () => updateClient(client.id, {
      name: name.trim(),
      phone_display: phone.trim(),
      phone: phone.trim(),
      messenger: messenger.trim() || null,
      email: email.trim() || null,
      comment: comment.trim() || null,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Клиент">
      <div className="space-y-3">
        <Field label="Имя" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Телефон" required>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Мессенджер">
          <Input value={messenger} onChange={(e) => setMessenger(e.target.value)} placeholder="Telegram, WhatsApp…" />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Комментарий">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <ErrorText error={save.error} />
        <Button className="w-full" disabled={!name.trim() || !phone.trim() || save.isPending} onClick={() => save.mutate()}>
          Сохранить
        </Button>
      </div>
    </Modal>
  );
}
