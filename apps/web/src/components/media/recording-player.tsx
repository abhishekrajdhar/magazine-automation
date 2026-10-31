"use client";

import * as React from "react";
import { FlaskConical, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import type { VideoSource } from "@/lib/domain/types";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/primitives";
import { PlaceholderPhoto } from "@/components/magazine/placeholder-photo";
import { formatDuration } from "@/lib/utils/format";

export interface PlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

interface Props {
  video: VideoSource;
  localUrl?: string;
  onTime: (seconds: number) => void;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Plays the recording behind a VideoSource:
 *  - a local file the user added in this browser → native <video>/<audio>
 *  - a real YouTube video → the official embed, driven via its postMessage API
 *  - seeded demo media (no file) → clearly labelled simulated playback
 */
export const RecordingPlayer = React.forwardRef<PlayerHandle, Props>(function RecordingPlayer({ video, localUrl, onTime }, ref) {
  if (localUrl) return <MediaElementPlayer ref={ref} url={localUrl} audio={video.sourceType === "upload_audio"} onTime={onTime} />;
  if (video.sourceType === "youtube" && video.externalId && YT_ID.test(video.externalId) && !video.simulated) return <YouTubePlayer ref={ref} id={video.externalId} onTime={onTime} />;
  return <SimulatedPlayer ref={ref} video={video} onTime={onTime} />;
});

/* ------------------------------------------------------------------ */

const MediaElementPlayer = React.forwardRef<PlayerHandle, { url: string; audio: boolean; onTime: (s: number) => void }>(function MediaElementPlayer({ url, audio, onTime }, ref) {
  const el = React.useRef<HTMLMediaElement | null>(null);
  React.useImperativeHandle(ref, () => ({
    seek: (s, play) => {
      if (!el.current) return;
      el.current.currentTime = s;
      if (play) void el.current.play();
    },
  }));
  const media = { src: url, controls: true, onTimeUpdate: () => onTime(el.current?.currentTime ?? 0) };
  return audio ? (
    <div className="flex aspect-video flex-col items-center justify-center gap-4 rounded-lg bg-gradient-to-br from-[#16213d] to-[#2a3d6b] p-6">
      <p className="text-sm text-white/70">Audio recording (local file)</p>
      <audio ref={(n) => { el.current = n; }} {...media} className="w-full" />
    </div>
  ) : (
    <video ref={(n) => { el.current = n; }} {...media} className="aspect-video w-full rounded-lg bg-black" />
  );
});

/* ------------------------------------------------------------------ */

const YouTubePlayer = React.forwardRef<PlayerHandle, { id: string; onTime: (s: number) => void }>(function YouTubePlayer({ id, onTime }, ref) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const send = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube-nocookie.com");
  React.useImperativeHandle(ref, () => ({
    seek: (s, play) => {
      send("seekTo", [s, true]);
      if (play) send("playVideo");
    },
  }));
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.event === "infoDelivery" && typeof data.info?.currentTime === "number") onTime(data.info.currentTime);
      } catch {
        /* not a player message */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onTime]);
  return (
    <iframe
      ref={frame}
      className="aspect-video w-full rounded-lg bg-black"
      src={`https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&rel=0&modestbranding=1`}
      title="YouTube recording"
      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening" }), "https://www.youtube-nocookie.com")}
    />
  );
});

/* ------------------------------------------------------------------ */

const SimulatedPlayer = React.forwardRef<PlayerHandle, { video: VideoSource; onTime: (s: number) => void }>(function SimulatedPlayer({ video, onTime }, ref) {
  const duration = video.durationSec ?? 0;
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(4);
  React.useImperativeHandle(ref, () => ({
    seek: (s, play) => {
      setTime(Math.max(0, Math.min(duration, s)));
      if (play) setPlaying(true);
    },
  }));
  React.useEffect(() => onTime(time), [time, onTime]);
  React.useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setTime((t) => {
        const next = t + dt;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, duration]);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-navy">
      <div className="relative aspect-video">
        <PlaceholderPhoto seed={(video.id.charCodeAt(video.id.length - 1) * 37) % 997} tag="panel" className="absolute inset-0 h-full w-full opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded bg-[#fdf8ec] px-2 py-1 text-[11px] font-medium text-[#8a5a00]">
          <FlaskConical className="size-3" /> Simulated playback — demo recording has no media file
        </div>
        <button onClick={() => setPlaying((p) => !p)} className="absolute inset-0 flex items-center justify-center" aria-label={playing ? "Pause" : "Play"}>
          {!playing && (
            <span className="flex size-14 items-center justify-center rounded-full bg-white/90 text-navy shadow-lg">
              <Play className="ml-0.5 size-6" fill="currentColor" />
            </span>
          )}
        </button>
        <p className="absolute bottom-3 left-4 right-4 truncate text-sm font-medium text-white">{video.title}</p>
      </div>
      <div className="flex items-center gap-3 bg-[#0b1630] px-3 py-2 text-white">
        <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setTime((t) => Math.max(0, t - 15))} aria-label="Back 15 seconds">
          <SkipBack />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setTime((t) => Math.min(duration, t + 15))} aria-label="Forward 15 seconds">
          <SkipForward />
        </Button>
        <span className="tabular w-[92px] text-xs text-white/80">
          {formatDuration(time)} / {formatDuration(duration)}
        </span>
        <Slider className="flex-1 [&_[data-orientation]]:bg-white/20" min={0} max={Math.max(1, duration)} step={1} value={[time]} onValueChange={([v]) => setTime(v)} aria-label="Seek" />
        <button className="tabular rounded px-1.5 py-0.5 text-[11px] text-white/70 hover:bg-white/10" onClick={() => setSpeed((s) => (s >= 16 ? 1 : s * 2))} title="Playback speed (simulated)">
          {speed}×
        </button>
        <Button variant="ghost" size="icon-sm" className="text-white hover:bg-white/10 hover:text-white" onClick={() => { setTime(0); setPlaying(false); }} aria-label="Restart">
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
});
