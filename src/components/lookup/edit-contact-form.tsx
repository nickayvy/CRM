"use client";

import { useState, useTransition } from "react";
import { BriefcaseBusiness, ExternalLink, Globe, Loader2, Mail, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ContactDetailsInput, updateContactDetailsAction } from "@/features/lookup/actions";
import { socialLink } from "@/features/lookup/links";
import type { LookupBusiness } from "@/features/lookup/types";
import { formatPhone } from "@/lib/format";

type Key = keyof Required<ContactDetailsInput>;

const FIELDS: { key: Key; label: string; icon: typeof Globe; type: string; placeholder: string; autoComplete?: string }[] = [
  { key: "phone", label: "Phone", icon: Phone, type: "tel", placeholder: "(800) 383-6008", autoComplete: "off" },
  { key: "email", label: "Email", icon: Mail, type: "email", placeholder: "hello@example.com", autoComplete: "off" },
  { key: "website", label: "Website", icon: Globe, type: "text", placeholder: "example.com" },
  { key: "facebook", label: "Facebook", icon: ExternalLink, type: "text", placeholder: "facebook.com/example" },
  { key: "twitter", label: "X / Twitter", icon: ExternalLink, type: "text", placeholder: "x.com/example" },
  { key: "linkedin", label: "Founder (LinkedIn)", icon: BriefcaseBusiness, type: "text", placeholder: "linkedin.com/in/…" },
  { key: "googleMapsUrl", label: "Google Maps", icon: MapPin, type: "text", placeholder: "maps.google.com/…" },
];

/** The values the form starts from: what the dossier shows now. */
export function initialContactValues(b: LookupBusiness): Record<Key, string> {
  return {
    phone: b.phone ? formatPhone(b.phone) : "",
    email: b.email ?? "",
    website: b.website ?? "",
    facebook: socialLink(b.socialLinks, "facebook") ?? "",
    twitter: socialLink(b.socialLinks, "twitter", "x") ?? "",
    linkedin: socialLink(b.socialLinks, "linkedin") ?? "",
    googleMapsUrl: b.googleMapsUrl ?? "",
  };
}

type Props = {
  business: LookupBusiness;
  onCancel: () => void;
  /** Told after a save that changed something, so the dossier reloads. */
  onSaved: () => void;
};

/**
 * Edits a business's contact details in place of the external-link tiles.
 * Only changed fields are sent; the server keeps them through later syncs, and
 * a new phone number is what the call campaigns dial from then on.
 */
export function EditContactForm({ business: b, onCancel, onSaved }: Props) {
  const [initial] = useState(() => initialContactValues(b));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, startSaving] = useTransition();

  const dirty = (Object.keys(values) as Key[]).filter((k) => values[k].trim() !== initial[k].trim());

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (dirty.length === 0) {
      onCancel();
      return;
    }
    const input: ContactDetailsInput = Object.fromEntries(dirty.map((k) => [k, values[k]]));
    startSaving(async () => {
      const res = await updateContactDetailsAction(b.id, input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error("Could not save", { description: res.message ?? "Unknown error" });
        return;
      }
      setErrors({});
      const phoneChanged = res.data.changed.includes("phone");
      toast.success("Details saved", {
        description: phoneChanged
          ? `${b.name}: call campaigns will dial the new number from now on.`
          : `${b.name}: your edits are kept through future syncs.`,
      });
      onSaved();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3" data-testid="edit-contact-form" noValidate>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FIELDS.map(({ key, label, icon: Icon, type, placeholder, autoComplete }) => {
          const err = errors[key]?.[0];
          const id = `contact-${key}`;
          return (
            <div key={key} className="flex min-w-0 flex-col gap-1 rounded-md bg-surface px-2.5 py-2">
              <label htmlFor={id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase">
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                {label}
              </label>
              <Input
                id={id}
                name={key}
                type={type}
                inputMode={key === "phone" ? "tel" : undefined}
                autoComplete={autoComplete}
                placeholder={placeholder}
                value={values[key]}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? `${id}-error` : undefined}
                className="h-7 text-xs"
                disabled={saving}
              />
              {err && (
                <p id={`${id}-error`} className="text-[11px] text-destructive">
                  {err}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-muted-foreground">
          Edited fields are kept when the business is synced again. Clear a field to remove it.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || dirty.length === 0}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Save changes
          </Button>
        </div>
      </div>
    </form>
  );
}
