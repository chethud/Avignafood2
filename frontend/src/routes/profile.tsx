import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { api, clearAuth, mediaUrl } from "@/lib/api";
import { useMe } from "@/lib/me-context";
import { nameInitials } from "@/lib/format";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [{ title: "Profile · Avighna" }],
  }),
  component: Profile,
});

function Profile() {
  const navigate = useNavigate();
  const { me, refresh } = useMe();
  const fileRef = useRef<HTMLInputElement>(null);
  const name = me?.user.full_name || "User";
  const email = me?.user.email || "";
  const photo = me?.user.photo_url || null;
  const [profileName, setProfileName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });

  useEffect(() => {
    setProfileName(me?.user.full_name || "");
    setPhone(me?.user.phone || "");
  }, [me?.user.full_name, me?.user.phone]);

  async function save() {
    setError("");
    setOkMsg("");
    const next = profileName.trim();
    if (!next) {
      setError("Enter your name");
      return;
    }
    setSaving(true);
    try {
      await api("/api/v1/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ full_name: next, phone: phone.trim() || null }),
      });
      await refresh();
      setOkMsg("Profile saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    setError("");
    setOkMsg("");
    if (!pwd.current || !pwd.next || !pwd.confirm) {
      setError("Fill current password, new password and confirm");
      return;
    }
    if (pwd.next.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    if (pwd.next !== pwd.confirm) {
      setError("New passwords do not match");
      return;
    }
    setPwdBusy(true);
    try {
      await api("/api/v1/auth/me/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: pwd.current,
          new_password: pwd.next,
          confirm_password: pwd.confirm,
        }),
      });
      setPwd({ current: "", next: "", confirm: "" });
      setOkMsg("Password updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update password");
    } finally {
      setPwdBusy(false);
    }
  }

  async function onPhotoFile(file: File | null) {
    if (!file) return;
    setError("");
    setOkMsg("");
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      await api("/api/v1/auth/me/photo", { method: "POST", body });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload photo");
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    setError("");
    setOkMsg("");
    setUploading(true);
    try {
      await api("/api/v1/auth/me/photo", { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove photo");
    } finally {
      setUploading(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          disabled={uploading}
          aria-label="Change profile photo"
          onClick={() => fileRef.current?.click()}
          className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-lg font-semibold text-primary-foreground disabled:opacity-60"
        >
          {photo ? (
            <img src={mediaUrl(photo)} alt="" className="size-full object-cover" />
          ) : (
            nameInitials(name) || "S"
          )}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/45 py-0.5">
            <Camera className="size-3.5 text-white" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            void onPhotoFile(f);
          }}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          {email ? <p className="truncate text-sm text-muted-foreground">{email}</p> : null}
          <p className="text-xs capitalize text-muted-foreground">{me?.user.role?.replaceAll("_", " ") || "User"}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="text-xs font-medium text-primary disabled:opacity-60"
            >
              {uploading ? "Uploading…" : photo ? "Change photo" : "Add photo"}
            </button>
            {photo ? (
              <button
                type="button"
                disabled={uploading}
                onClick={() => void removePhoto()}
                className="text-xs font-medium text-muted-foreground disabled:opacity-60"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close profile"
          onClick={() => navigate({ to: "/" })}
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border"
        >
          <X className="size-5" />
        </button>
      </div>

      <label className="block text-sm font-medium">
        Name
        <input
          type="text"
          autoComplete="name"
          placeholder="Your name"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="block text-sm font-medium">
        Mobile number
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Enter mobile number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputCls}
        />
      </label>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save profile"}
      </button>

      <div className="rounded-2xl border border-border p-4">
        <h2 className="text-sm font-semibold">Change password</h2>
        <p className="mt-1 text-xs text-muted-foreground">Any signed-in user can update their own password here.</p>
        <div className="mt-3 space-y-3">
          <label className="block text-sm font-medium">
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={pwd.current}
              onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))}
              className={inputCls}
            />
          </label>
          <label className="block text-sm font-medium">
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={pwd.next}
              onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))}
              className={inputCls}
              placeholder="At least 6 characters"
            />
          </label>
          <label className="block text-sm font-medium">
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={pwd.confirm}
              onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))}
              className={inputCls}
            />
          </label>
          <button
            type="button"
            disabled={pwdBusy}
            onClick={() => void changePassword()}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-border text-sm font-medium disabled:opacity-60"
          >
            {pwdBusy ? "Updating…" : "Update password"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {okMsg && !error && <p className="text-sm text-emerald-600">{okMsg}</p>}

      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-border text-sm font-medium"
        onClick={() => {
          clearAuth();
          navigate({ to: "/login" });
        }}
      >
        Log out
      </button>
    </div>
  );
}
