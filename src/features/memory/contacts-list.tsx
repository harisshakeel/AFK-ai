"use client";

import { Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { reasonFor } from "@/features/connectors/address-book";
import type { ContactView } from "@/server/connectors/store";
import { visitorFetch } from "@/lib/visitor-api";

/**
 * The people AFK knows an address for (learned from the cards you confirmed, your
 * People file and, when imported, your Google contacts), most used first. Each row says
 * where it came from; delete any, and AFK stops suggesting it.
 */
export function ContactsList({ contacts }: { contacts: ReadonlyArray<ContactView> }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const remove = async (contact: ContactView) => {
    setBusy(contact.id);
    try {
      await visitorFetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
      toast(`Forgot ${contact.name}`);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "That didn't work.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="contacts-title" className="mt-10">
      <h2 id="contacts-title" className="flex items-center gap-2 text-lg font-semibold">
        <Users className="size-5 text-accent-strong" aria-hidden />
        People AFK knows
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Addresses AFK learned from the cards you approved and from your Google contacts, most used
        first. They fill in the To field as a best guess, with the reason, and you confirm every
        time. Delete one and it is forgotten.
      </p>
      {contacts.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border-strong p-5 text-sm text-fg-muted">
          Nobody yet. Approve an email or an invite, or import your Google contacts on the
          Connectors page, and the people land here.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="font-medium">{contact.name}</span>
                  {contact.aliases.length > 0 && (
                    <span className="text-fg-subtle"> · also {contact.aliases.join(", ")}</span>
                  )}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  {contact.email} · {reasonFor(contact)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Forget ${contact.name}`}
                loading={busy === contact.id}
                onClick={() => void remove(contact)}
              >
                {busy !== contact.id && <Trash2 className="size-4" aria-hidden />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
