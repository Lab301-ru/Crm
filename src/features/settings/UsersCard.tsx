import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchProfiles } from "@/shared/api/settings";
import { adminUsers } from "@/shared/api/admin";
import { useAuth } from "@/app/AuthProvider";
import type { Profile, Role } from "@/shared/api/types";
import { Button, Card, ErrorText, Field, Input, Modal, Select, Spinner } from "@/shared/ui";

const roleLabels: Record<Role, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  master: "Мастер",
};

/** Сотрудники: создание, роль, пароль, деактивация — через admin-users (service_role). */
export function UsersCard() {
  const { profile: me } = useAuth();
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: fetchProfiles });
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState<Profile | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["profiles"] });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      adminUsers({ action: "set_role", user_id: id, role }),
    onSuccess: invalidate,
  });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      adminUsers({ action: "set_active", user_id: id, active }),
    onSuccess: invalidate,
  });

  if (profiles.isLoading) return <Spinner />;

  return (
    <Card
      title="Сотрудники"
      actions={<Button onClick={() => setCreating(true)}>+ Сотрудник</Button>}
    >
      <ul className="divide-y divide-border">
        {profiles.data?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className={`text-sm font-medium ${p.is_active ? "" : "text-muted line-through"}`}>
                {p.full_name}
                {p.id === me?.id && <span className="text-xs text-muted"> (вы)</span>}
              </p>
              {p.phone && <p className="text-xs text-muted">{p.phone}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Select
                className="w-40 py-1.5 text-xs"
                value={p.role}
                disabled={p.id === me?.id || setRole.isPending}
                onChange={(e) => setRole.mutate({ id: p.id, role: e.target.value as Role })}
              >
                {(Object.keys(roleLabels) as Role[]).map((r) => (
                  <option key={r} value={r}>{roleLabels[r]}</option>
                ))}
              </Select>
              <Button variant="ghost" onClick={() => setPasswordFor(p)}>Пароль</Button>
              <Button
                variant={p.is_active ? "danger" : "secondary"}
                disabled={p.id === me?.id || setActive.isPending}
                onClick={() => setActive.mutate({ id: p.id, active: !p.is_active })}
              >
                {p.is_active ? "Деактивировать" : "Активировать"}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ErrorText error={setRole.error ?? setActive.error} />

      {creating && <CreateUserModal onClose={() => { setCreating(false); invalidate(); }} />}
      {passwordFor && <SetPasswordModal user={passwordFor} onClose={() => setPasswordFor(null)} />}
    </Card>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("manager");

  const create = useMutation({
    mutationFn: () =>
      adminUsers({
        action: "create",
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        phone: phone.trim() || undefined,
        role,
      }),
    onSuccess: onClose,
  });

  return (
    <Modal open onClose={onClose} title="Новый сотрудник">
      <div className="space-y-3">
        <Field label="ФИО" required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Петров Пётр" />
        </Field>
        <Field label="Email (логин)" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Телефон">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Роль" required>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(roleLabels) as Role[]).map((r) => (
                <option key={r} value={r}>{roleLabels[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Пароль (мин. 8)" required>
            <Input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </div>
        <ErrorText error={create.error} />
        <Button
          className="w-full"
          disabled={!fullName.trim() || !email.trim() || password.length < 8 || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Создаём…" : "Создать сотрудника"}
        </Button>
      </div>
    </Modal>
  );
}

function SetPasswordModal({ user, onClose }: { user: Profile; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const set = useMutation({
    mutationFn: () => adminUsers({ action: "set_password", user_id: user.id, password }),
    onSuccess: onClose,
  });

  return (
    <Modal open onClose={onClose} title={`Новый пароль: ${user.full_name}`}>
      <div className="space-y-3">
        <Field label="Пароль (мин. 8 символов)" required>
          <Input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">
          Сообщите пароль сотруднику лично. Он сможет сменить его через «Забыли пароль?» на странице входа.
        </p>
        <ErrorText error={set.error} />
        <Button className="w-full" disabled={password.length < 8 || set.isPending} onClick={() => set.mutate()}>
          Сохранить
        </Button>
      </div>
    </Modal>
  );
}
