import { useEffect, useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PurchaseOrderDetail } from "@/api/purchasing";
import type { PoSendChannel } from "@/schemas/purchaseOrder";
import {
  PO_SEND_PROVIDERS,
  buildPoTextMessage,
  openPoSendTarget,
  type PoSendTarget,
} from "@/lib/poSend";
import {
  useResendPurchaseOrder,
  useSendPurchaseOrder,
} from "./hooks";

interface PoSendDialogProps {
  open: boolean;
  po: PurchaseOrderDetail;
  restaurantName: string;
  /**
   * When true the PO already left draft: the confirm step records a
   * re-send (audit-only) instead of the draft → sent lifecycle transition.
   */
  resend: boolean;
  onClose: () => void;
}

const channelIcon: Record<PoSendChannel, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  email: Mail,
};

const channelHint: Record<PoSendChannel, string> = {
  whatsapp: "Opens WhatsApp with the order text ready to send.",
  email: "Opens your email app with the order composed.",
};

const missingContact: Record<PoSendChannel, string> = {
  whatsapp: "Add a phone number to the supplier to send via WhatsApp.",
  email: "Add an email address to the supplier to send via email.",
};

/**
 * V2-05: send a PO through a channel. Two steps because the app cannot
 * observe the external app: (1) pick a channel and open the deep link,
 * (2) confirm the send actually happened, which records it (lifecycle
 * transition for drafts, audit-only re-send otherwise).
 *
 * Owner/manager only — the page itself is already role-gated (POs carry
 * costs) and the RPCs enforce the role again.
 */
export function PoSendDialog({ open, po, restaurantName, resend, onClose }: PoSendDialogProps) {
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [target, setTarget] = useState<PoSendTarget | null>(null);

  const sendMutation = useSendPurchaseOrder();
  const resendMutation = useResendPurchaseOrder();

  useEffect(() => {
    if (open) {
      setStep("choose");
      setTarget(null);
    }
  }, [open ]);

  if (!open) {
    return null;
  }

  const targets = new Map<PoSendChannel, PoSendTarget | null>(
    PO_SEND_PROVIDERS.map((p) => [p.channel, p.buildTarget(po, restaurantName)]),
  );

  const chooseChannel = (built: PoSendTarget) => {
    openPoSendTarget(built);
    setTarget(built);
    setStep("confirm");
  };

  const confirmSend = () => {
    if (!target) {
      return;
    }
    if (resend) {
      resendMutation.mutate(
        { id: po.id, channel: target.channel },
        { onSuccess: onClose },
      );
    } else {
      sendMutation.mutate(
        { id: po.id, channel: target.channel },
        { onSuccess: onClose },
      );
    }
  };

  const pending = sendMutation.isPending || resendMutation.isPending;
  const Icon = target ? channelIcon[target.channel] : MessageCircle;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={resend ? "Re-send purchase order" : "Send purchase order"}
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg rounded-lg bg-background p-6 shadow-lg">
        {step === "choose" ? (
          <>
            <h2 className="text-lg font-semibold">
              {resend ? "Re-send purchase order" : "Send purchase order"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose how to reach {po.supplierName}. The order text opens in
              the other app — nothing is sent until you tap send there.
            </p>

            {po.lineCount === 0 && (
              <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                This order has no lines yet. Add at least one line before sending.
              </p>
            )}

            <div className="mt-4 space-y-2">
              {PO_SEND_PROVIDERS.map((provider) => {
                const built = targets.get(provider.channel) ?? null;
                const ChannelIcon = channelIcon[provider.channel];
                return (
                  <div
                    key={provider.channel}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <ChannelIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{provider.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {built ? `${channelHint[provider.channel]} To: ${built.destination}` : missingContact[provider.channel]}
                      </p>
                    </div>
                    <Button
                      className="min-h-[44px] shrink-0"
                      disabled={!built || po.lineCount === 0}
                      onClick={() => built && chooseChannel(built)}
                      aria-label={
                        built
                          ? `Send via ${provider.label} to ${built.destination}`
                          : `${provider.label} unavailable`
                      }
                    >
                      Open
                    </Button>
                  </div>
                );
              })}
            </div>

            <details className="mt-4 rounded-lg border">
              <summary className="cursor-pointer p-3 text-sm font-medium">
                Preview the message
              </summary>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t p-3 text-xs">
                {buildPoTextMessage(po, restaurantName, false)}
              </pre>
            </details>

            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          target && (
            <>
              <div className="flex items-center gap-3">
                <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-lg font-semibold">
                  Did you send it via {target.channel === "whatsapp" ? "WhatsApp" : "Email"}?
                </h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {target.channel === "whatsapp" ? "WhatsApp" : "Email"} opened with
                the order text addressed to {target.destination}. This app
                can&apos;t see the other app — confirm below to record the{" "}
                {resend ? "re-send" : "send"} in the order history.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("choose")}
                  disabled={pending}
                >
                  Back
                </Button>
                <Button
                  onClick={confirmSend}
                  disabled={pending}
                  className="min-h-[44px]"
                >
                  {pending
                    ? "Recording…"
                    : resend
                      ? "Record re-send"
                      : "Mark as sent"}
                </Button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}
