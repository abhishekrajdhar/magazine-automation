"use client";

import * as React from "react";
import { ImagePlus, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/store/workspace";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Segmented, Tooltip } from "@/components/ui/primitives";
import { live, type ImageAspect } from "@/lib/api/live";
import { integration, useApiStatus } from "@/lib/api/use-api-status";
import type { Asset } from "@/lib/domain/types";

export const AI_IMAGE_TAG = "ai-generated";
export const isAiImage = (a: Asset) => a.tags.includes(AI_IMAGE_TAG);

/** The closest generation shape for a frame of this width and height. */
export function aspectFor(w: number, h: number): ImageAspect {
  const r = w / h;
  return r > 1.15 ? "landscape" : r < 0.87 ? "portrait" : "square";
}

const addToStore = (a: Asset) => useWorkspace.setState((s) => ({ assets: [a, ...s.assets.filter((x) => x.id !== a.id)] }));

/**
 * Upload photographs or generate one with AI into a project's image library.
 * `onAdded` receives each new image, e.g. so the page editor can place it.
 */
export function AddImages({
  projectId,
  onAdded,
  defaultPrompt = "",
  defaultAspect = "landscape",
  sessionId,
  size = "sm",
}: {
  projectId: string;
  onAdded?: (a: Asset) => void;
  defaultPrompt?: string;
  defaultAspect?: ImageAspect;
  sessionId?: string;
  size?: "xs" | "sm";
}) {
  const mode = useWorkspace((s) => s.mode);
  const api = useApiStatus();
  const images = integration(api.integrations, "images");
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const liveReason = mode !== "live" ? "Sign in to a live organisation to add images." : !api.online ? "The PressFlow API isn't connected." : null;
  const genReason = liveReason ?? (images && !images.configured ? images.detail ?? "AI images aren't configured on the API." : null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    let done = 0;
    for (const file of list) {
      setUploading(list.length > 1 ? `${done + 1}/${list.length}` : "…");
      try {
        const a = await live.uploadAsset(projectId, file);
        addToStore(a);
        onAdded?.(a);
        done++;
      } catch (err) {
        toast.error(`${file.name} wasn't uploaded`, { description: (err as Error).message });
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    if (done) toast.success(done === 1 ? "Image added" : `${done} images added`);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/tiff" multiple hidden onChange={(e) => void upload(e.target.files)} />
        <Tooltip content={liveReason ?? "JPEG, PNG, WebP or TIFF, up to 50 MB each"}>
          <span>
            <Button variant="secondary" size={size} disabled={!!liveReason} loading={!!uploading} onClick={() => fileRef.current?.click()}>
              <Upload /> {uploading ? `Uploading ${uploading}` : "Upload images"}
            </Button>
          </span>
        </Tooltip>
        <Tooltip content={genReason ?? "Create an illustration from a description"}>
          <span>
            <Button variant="secondary" size={size} disabled={!!genReason} onClick={() => setOpen(true)}>
              <Sparkles /> Generate with AI
            </Button>
          </span>
        </Tooltip>
      </div>
      <GenerateImageDialog
        open={open}
        onOpenChange={setOpen}
        projectId={projectId}
        defaultPrompt={defaultPrompt}
        defaultAspect={defaultAspect}
        sessionId={sessionId}
        onGenerated={(a) => {
          addToStore(a);
          onAdded?.(a);
        }}
      />
    </>
  );
}

function GenerateImageDialog({
  open,
  onOpenChange,
  projectId,
  defaultPrompt,
  defaultAspect,
  sessionId,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  defaultPrompt: string;
  defaultAspect: ImageAspect;
  sessionId?: string;
  onGenerated: (a: Asset) => void;
}) {
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [aspect, setAspect] = React.useState<ImageAspect>(defaultAspect);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setPrompt(defaultPrompt);
    setAspect(defaultAspect);
  }, [open, defaultPrompt, defaultAspect]);

  const generate = async () => {
    setBusy(true);
    try {
      const a = await live.generateImage(projectId, { prompt, aspect, sessionId });
      onGenerated(a);
      toast.success("AI image added", { description: "It's labelled AI-generated in the library and credited as such." });
      onOpenChange(false);
    } catch (err) {
      toast.error("Image not generated", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        title="Generate an image with AI"
        description="Describe the picture. It's added to this project's images, labelled AI-generated."
        size="md"
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={prompt.trim().length < 3} onClick={() => void generate()}>
              <ImagePlus /> {busy ? "Generating… (up to a minute)" : "Generate"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Description">
            <Textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="e.g. Students using tablets in a sunlit classroom, documentary photography style" autoFocus />
          </Field>
          <Field label="Shape">
            <Segmented<ImageAspect>
              value={aspect}
              onChange={setAspect}
              options={[
                { value: "portrait", label: "Portrait · cover / full page" },
                { value: "landscape", label: "Landscape" },
                { value: "square", label: "Square" },
              ]}
            />
          </Field>
          <ul className="list-disc space-y-1 pl-4 text-xs text-ink-3">
            <li>Don&apos;t describe real speakers or other real people: AI images never show identifiable people. Use their photographs for that.</li>
            <li>The image comes without words. Masthead, headlines and cover lines stay live text from the page template.</li>
            <li>Images are about 1024–1536 px: sharp on screen and in smaller frames, soft across a full printed page. Preflight flags that.</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
