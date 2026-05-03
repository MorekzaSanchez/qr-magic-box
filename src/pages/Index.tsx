import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import jsPDF from "jspdf";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Download, QrCode, Sparkles, Layers, Loader2, ScanLine, Upload, Copy, ExternalLink, X, Camera } from "lucide-react";
import jsQR from "jsqr";

type BulkFormat = "png" | "png-transparent" | "jpeg" | "svg" | "pdf";

const slugify = (s: string, i: number) => {
  const base = s.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `${String(i + 1).padStart(3, "0")}_${base || "qr"}`;
};

type ECLevel = "L" | "M" | "Q" | "H";

const Index = () => {
  const [text, setText] = useState("https://lovable.dev");
  const [size, setSize] = useState(512);
  const [margin, setMargin] = useState(2);
  const [fgColor, setFgColor] = useState("#0afba1");
  const [bgColor, setBgColor] = useState("#0f1419");
  const [ecLevel, setEcLevel] = useState<ECLevel>("M");
  const [svgString, setSvgString] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [bulkInput, setBulkInput] = useState("https://lovable.dev\nhttps://github.com\nhttps://example.com");
  const [bulkFormat, setBulkFormat] = useState<BulkFormat>("png");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  // Scanner state
  const [scanResult, setScanResult] = useState<string>("");
  const [scanPreview, setScanPreview] = useState<string>("");
  const [scanBusy, setScanBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bulk scan state
  type BulkScanRow = { file: string; data: string; status: "ok" | "fail"; thumb: string };
  const [bulkScanBusy, setBulkScanBusy] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState(0);
  const [bulkScanResults, setBulkScanResults] = useState<BulkScanRow[]>([]);
  const bulkScanInputRef = useRef<HTMLInputElement>(null);

  // History (persisted)
  type HistoryEntry = { id: string; at: number; data: string; status: "ok" | "fail"; file: string; thumb: string; source: "single" | "bulk" | "camera" };
  const HISTORY_KEY = "qr_scan_history_v1";
  const HISTORY_LIMIT = 100;
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT))); } catch { /* noop */ }
  }, [history]);
  const addHistory = (entries: HistoryEntry[]) => {
    if (!entries.length) return;
    setHistory((prev) => [...entries, ...prev].slice(0, HISTORY_LIMIT));
  };
  const clearHistory = () => setHistory([]);

  const isUrl = (s: string) => /^(https?:\/\/|mailto:|tel:|sms:|geo:)/i.test(s.trim());

  const decodeImageData = (img: HTMLImageElement | HTMLVideoElement, w: number, h: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
  };

  const handleScanFile = async (file: File) => {
    if (!file) return;
    setScanBusy(true);
    setScanResult("");
    try {
      const url = URL.createObjectURL(file);
      setScanPreview(url);
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const code = decodeImageData(img, w, h);
      const thumb = await makeThumb(file);
      if (code?.data) {
        setScanResult(code.data);
        addHistory([{ id: `${Date.now()}`, at: Date.now(), data: code.data, status: "ok", file: file.name, thumb, source: "single" }]);
        toast({ title: "QR decoded", description: code.data.slice(0, 60) });
      } else {
        addHistory([{ id: `${Date.now()}`, at: Date.now(), data: "", status: "fail", file: file.name, thumb, source: "single" }]);
        toast({ title: "No QR found", description: "Try a clearer or higher-res image.", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Failed to scan", description: String(e), variant: "destructive" });
    } finally {
      setScanBusy(false);
    }
  };

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      const tick = () => {
        const v = videoRef.current;
        if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
          const code = decodeImageData(v, v.videoWidth, v.videoHeight);
          if (code?.data) {
            setScanResult(code.data);
            addHistory([{ id: `${Date.now()}`, at: Date.now(), data: code.data, status: "ok", file: "camera", thumb: "", source: "camera" }]);
            toast({ title: "QR decoded", description: code.data.slice(0, 60) });
            stopCamera();
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      toast({ title: "Camera unavailable", description: String(e), variant: "destructive" });
    }
  };

  useEffect(() => () => stopCamera(), []);

  const copyResult = async () => {
    if (!scanResult) return;
    await navigator.clipboard.writeText(scanResult);
    toast({ title: "Copied", description: "Decoded data copied to clipboard." });
  };

  const clearScan = () => {
    setScanResult("");
    setScanPreview("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const decodeFileToText = async (file: File): Promise<string | null> => {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const code = decodeImageData(img, w, h);
      return code?.data ?? null;
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const csvEscape = (s: string) => `"${s.replace(/"/g, '""')}"`;

  const makeThumb = async (file: File, max = 96): Promise<string> => {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/jpeg", 0.7);
    } catch {
      return "";
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const handleBulkScan = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (files.length > 500) {
      toast({ title: "Too many", description: "Limit is 500 images per batch.", variant: "destructive" });
      return;
    }
    setBulkScanBusy(true);
    setBulkScanProgress(0);
    setBulkScanResults([]);
    const rows: BulkScanRow[] = [];
    try {
      const arr = Array.from(files);
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        const thumb = await makeThumb(f);
        try {
          const data = await decodeFileToText(f);
          rows.push({ file: f.name, data: data ?? "", status: data ? "ok" : "fail", thumb });
        } catch {
          rows.push({ file: f.name, data: "", status: "fail", thumb });
        }
        setBulkScanProgress(Math.round(((i + 1) / arr.length) * 100));
      }
      setBulkScanResults(rows);
      addHistory(rows.map((r, idx) => ({
        id: `${Date.now()}_${idx}`,
        at: Date.now(),
        data: r.data,
        status: r.status,
        file: r.file,
        thumb: r.thumb,
        source: "bulk" as const,
      })));

      const zip = new JSZip();
      const csv = ["file,status,data", ...rows.map((r) => `${csvEscape(r.file)},${r.status},${csvEscape(r.data)}`)].join("\n");
      const txt = rows.map((r) => (r.status === "ok" ? r.data : `# FAILED: ${r.file}`)).join("\n");
      const okOnly = rows.filter((r) => r.status === "ok").map((r) => r.data).join("\n");
      zip.file("results.csv", csv);
      zip.file("results.txt", txt);
      zip.file("decoded-only.txt", okOnly);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `qr-scan-${rows.length}.zip`);

      const okCount = rows.filter((r) => r.status === "ok").length;
      toast({ title: "Done", description: `${okCount}/${rows.length} decoded.` });
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    } finally {
      setBulkScanBusy(false);
      setBulkScanProgress(0);
      if (bulkScanInputRef.current) bulkScanInputRef.current.value = "";
    }
  };

  const bulkValues = useMemo(
    () => bulkInput.split(/\r?\n/).map((v) => v.trim()).filter(Boolean),
    [bulkInput],
  );

  const opts = useMemo(
    () => ({
      errorCorrectionLevel: ecLevel,
      margin,
      width: size,
      color: { dark: fgColor, light: bgColor },
    }),
    [ecLevel, margin, size, fgColor, bgColor],
  );

  useEffect(() => {
    if (!text.trim()) return;
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, text, opts).catch(() => {});
    }
    QRCode.toString(text, { ...opts, type: "svg" })
      .then(setSvgString)
      .catch(() => {});
  }, [text, opts]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: filename });
  };

  const downloadPNG = async (transparent: boolean) => {
    if (!text.trim()) return;
    const dataUrl = await QRCode.toDataURL(text, {
      ...opts,
      color: { dark: fgColor, light: transparent ? "#0000" : bgColor },
    });
    const res = await fetch(dataUrl);
    downloadBlob(await res.blob(), transparent ? "qrcode-transparent.png" : "qrcode.png");
  };

  const downloadJPEG = async () => {
    if (!text.trim()) return;
    const canvas = document.createElement("canvas");
    await QRCode.toCanvas(canvas, text, opts);
    canvas.toBlob((b) => b && downloadBlob(b, "qrcode.jpg"), "image/jpeg", 0.95);
  };

  const downloadSVG = () => {
    if (!svgString) return;
    downloadBlob(new Blob([svgString], { type: "image/svg+xml" }), "qrcode.svg");
  };

  const downloadPDF = async () => {
    if (!text.trim()) return;
    const dataUrl = await QRCode.toDataURL(text, { ...opts, width: 1024 });
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const imgSize = 360;
    const x = (pageW - imgSize) / 2;
    pdf.addImage(dataUrl, "PNG", x, 80, imgSize, imgSize);
    pdf.setFontSize(10);
    pdf.setTextColor(120);
    const label = text.length > 80 ? text.slice(0, 80) + "…" : text;
    pdf.text(label, pageW / 2, 80 + imgSize + 30, { align: "center" });
    pdf.save("qrcode.pdf");
    toast({ title: "Downloaded", description: "qrcode.pdf" });
  };

  const generateBulk = async () => {
    if (bulkValues.length === 0) {
      toast({ title: "No values", description: "Paste at least one URL or text.", variant: "destructive" });
      return;
    }
    if (bulkValues.length > 500) {
      toast({ title: "Too many", description: "Limit is 500 entries per batch.", variant: "destructive" });
      return;
    }
    setBulkBusy(true);
    setBulkProgress(0);
    try {
      if (bulkFormat === "pdf") {
        const pdf = new jsPDF({ unit: "pt", format: "a4" });
        const pageW = pdf.internal.pageSize.getWidth();
        const imgSize = 360;
        const x = (pageW - imgSize) / 2;
        for (let i = 0; i < bulkValues.length; i++) {
          const value = bulkValues[i];
          const dataUrl = await QRCode.toDataURL(value, { ...opts, width: 1024 });
          if (i > 0) pdf.addPage();
          pdf.addImage(dataUrl, "PNG", x, 80, imgSize, imgSize);
          pdf.setFontSize(10);
          pdf.setTextColor(120);
          const label = value.length > 80 ? value.slice(0, 80) + "…" : value;
          pdf.text(label, pageW / 2, 80 + imgSize + 30, { align: "center" });
          setBulkProgress(Math.round(((i + 1) / bulkValues.length) * 100));
        }
        pdf.save(`qrcodes-${bulkValues.length}.pdf`);
      } else {
        const zip = new JSZip();
        for (let i = 0; i < bulkValues.length; i++) {
          const value = bulkValues[i];
          const name = slugify(value, i);
          if (bulkFormat === "svg") {
            const svg = await QRCode.toString(value, { ...opts, type: "svg" });
            zip.file(`${name}.svg`, svg);
          } else if (bulkFormat === "png") {
            const dataUrl = await QRCode.toDataURL(value, opts);
            zip.file(`${name}.png`, dataUrl.split(",")[1], { base64: true });
          } else if (bulkFormat === "png-transparent") {
            const dataUrl = await QRCode.toDataURL(value, { ...opts, color: { dark: fgColor, light: "#0000" } });
            zip.file(`${name}.png`, dataUrl.split(",")[1], { base64: true });
          } else if (bulkFormat === "jpeg") {
            const canvas = document.createElement("canvas");
            await QRCode.toCanvas(canvas, value, opts);
            const blob: Blob = await new Promise((res) =>
              canvas.toBlob((b) => res(b!), "image/jpeg", 0.95),
            );
            zip.file(`${name}.jpg`, blob);
          }
          setBulkProgress(Math.round(((i + 1) / bulkValues.length) * 100));
        }
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `qrcodes-${bulkValues.length}.zip`);
      }
      toast({ title: "Done", description: `Generated ${bulkValues.length} QR codes.` });
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    } finally {
      setBulkBusy(false);
      setBulkProgress(0);
    }
  };

  return (
    <main className="min-h-screen px-4 py-10 md:py-16">
      <div className="mx-auto max-w-6xl">
        <header className="mb-12 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Free · No sign-up · Unlimited
          </div>
          <h1 className="bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-5xl font-bold text-transparent md:text-7xl">
            QR Forge
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Craft beautiful QR codes and export them as PNG, transparent PNG, JPEG, SVG, or PDF.
          </p>
        </header>

        <Tabs defaultValue="single" className="mb-6">
          <TabsList className="mx-auto grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="single" className="gap-2"><QrCode className="h-3.5 w-3.5" /> Single</TabsTrigger>
            <TabsTrigger value="bulk" className="gap-2"><Layers className="h-3.5 w-3.5" /> Bulk</TabsTrigger>
            <TabsTrigger value="scan" className="gap-2"><ScanLine className="h-3.5 w-3.5" /> Scan</TabsTrigger>
          </TabsList>
          <TabsContent value="single" className="mt-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          {/* Controls */}
          <Card className="border-border/60 bg-card/60 p-6 backdrop-blur md:p-8">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="content">Content or URL</Label>
                <Input
                  id="content"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="https://example.com"
                  className="h-11"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fg">Foreground</Label>
                  <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 h-11">
                    <input
                      id="fg"
                      type="color"
                      value={fgColor}
                      onChange={(e) => setFgColor(e.target.value)}
                      className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent"
                    />
                    <span className="font-mono text-xs text-muted-foreground">{fgColor}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bg">Background</Label>
                  <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 h-11">
                    <input
                      id="bg"
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent"
                    />
                    <span className="font-mono text-xs text-muted-foreground">{bgColor}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Size</Label>
                  <span className="font-mono text-xs text-muted-foreground">{size}px</span>
                </div>
                <Slider value={[size]} min={128} max={1024} step={32} onValueChange={(v) => setSize(v[0])} />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Quiet zone</Label>
                  <span className="font-mono text-xs text-muted-foreground">{margin}</span>
                </div>
                <Slider value={[margin]} min={0} max={8} step={1} onValueChange={(v) => setMargin(v[0])} />
              </div>

              <div className="space-y-2">
                <Label>Error correction</Label>
                <Select value={ecLevel} onValueChange={(v) => setEcLevel(v as ECLevel)}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">Low — ~7% recovery</SelectItem>
                    <SelectItem value="M">Medium — ~15% recovery</SelectItem>
                    <SelectItem value="Q">Quartile — ~25% recovery</SelectItem>
                    <SelectItem value="H">High — ~30% recovery</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          {/* Preview */}
          <Card
            className="flex flex-col items-center justify-between gap-6 border-border/60 bg-card/60 p-6 backdrop-blur md:p-8"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex w-full flex-1 items-center justify-center">
              <div
                className="rounded-2xl p-4 transition-all"
                style={{ background: bgColor, boxShadow: "var(--shadow-glow)" }}
              >
                <canvas
                  ref={canvasRef}
                  className="block max-h-[360px] max-w-full rounded-lg"
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
              <Button onClick={() => downloadPNG(false)} className="gap-2" variant="default">
                <Download className="h-4 w-4" /> PNG
              </Button>
              <Button onClick={() => downloadPNG(true)} className="gap-2" variant="secondary">
                <Download className="h-4 w-4" /> PNG · Transparent
              </Button>
              <Button onClick={downloadJPEG} className="gap-2" variant="secondary">
                <Download className="h-4 w-4" /> JPEG
              </Button>
              <Button onClick={downloadSVG} className="gap-2" variant="secondary">
                <Download className="h-4 w-4" /> SVG
              </Button>
              <Button onClick={downloadPDF} className="gap-2 sm:col-span-2" variant="secondary">
                <Download className="h-4 w-4" /> PDF
              </Button>
            </div>
          </Card>
        </div>
          </TabsContent>

          <TabsContent value="bulk" className="mt-6">
            <Card className="border-border/60 bg-card/60 p-6 backdrop-blur md:p-8">
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="bulk">Paste URLs or text — one per line</Label>
                  <Textarea
                    id="bulk"
                    value={bulkInput}
                    onChange={(e) => setBulkInput(e.target.value)}
                    placeholder={"https://example.com\nhttps://another.com\nAny text value"}
                    className="min-h-[220px] font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {bulkValues.length} entr{bulkValues.length === 1 ? "y" : "ies"} · uses current color, size & error correction settings · max 500
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="space-y-2">
                    <Label>Output format</Label>
                    <Select value={bulkFormat} onValueChange={(v) => setBulkFormat(v as BulkFormat)}>
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="png">PNG (.zip)</SelectItem>
                        <SelectItem value="png-transparent">PNG · Transparent (.zip)</SelectItem>
                        <SelectItem value="jpeg">JPEG (.zip)</SelectItem>
                        <SelectItem value="svg">SVG (.zip)</SelectItem>
                        <SelectItem value="pdf">PDF (multi-page)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={generateBulk} disabled={bulkBusy} className="h-11 gap-2">
                    {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {bulkBusy ? `Generating ${bulkProgress}%` : `Generate ${bulkValues.length || ""}`}
                  </Button>
                </div>

                {bulkBusy && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${bulkProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="scan" className="mt-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-border/60 bg-card/60 p-6 backdrop-blur md:p-8">
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-semibold">Decode a QR code</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Upload an image or scan with your camera. Everything runs locally.
                    </p>
                  </div>

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files?.[0];
                      if (f) handleScanFile(f);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-background/40 p-8 text-center transition-colors hover:border-primary/60 hover:bg-background/60"
                  >
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">Drop a QR image here or click to upload</p>
                    <p className="text-xs text-muted-foreground">PNG, JPEG, WEBP, SVG raster…</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleScanFile(f);
                      }}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-xl border border-border bg-black/40 aspect-video flex items-center justify-center">
                      {cameraOn ? (
                        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
                      ) : (
                        <div className="text-center text-sm text-muted-foreground">
                          <Camera className="mx-auto mb-2 h-8 w-8" />
                          Camera is off
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Button onClick={startCamera} disabled={cameraOn} className="gap-2">
                        <Camera className="h-4 w-4" /> Start camera
                      </Button>
                      <Button onClick={stopCamera} disabled={!cameraOn} variant="secondary" className="gap-2">
                        <X className="h-4 w-4" /> Stop
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="border-border/60 bg-card/60 p-6 backdrop-blur md:p-8">
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Scan result</h2>
                    {(scanResult || scanPreview) && (
                      <Button onClick={clearScan} variant="ghost" size="sm" className="gap-1.5">
                        <X className="h-3.5 w-3.5" /> Clear
                      </Button>
                    )}
                  </div>

                  {scanPreview && (
                    <div className="overflow-hidden rounded-xl border border-border bg-black/30 p-2">
                      <img src={scanPreview} alt="Uploaded QR" className="mx-auto max-h-64 rounded" />
                    </div>
                  )}

                  {scanBusy ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 p-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Decoding…
                    </div>
                  ) : scanResult ? (
                    <>
                      <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-wide text-primary">Decoded data</Label>
                        <div className="break-all rounded-lg border border-border bg-background/60 p-4 font-mono text-sm">
                          {scanResult}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {isUrl(scanResult) && (
                          <Button asChild className="gap-2 col-span-2">
                            <a href={scanResult} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" /> Open link
                            </a>
                          </Button>
                        )}
                        <Button onClick={copyResult} variant="secondary" className="gap-2 col-span-2">
                          <Copy className="h-4 w-4" /> Copy data
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-background/30 p-8 text-center text-sm text-muted-foreground">
                      Upload an image or start the camera to decode a QR code.
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Scanning is performed 100% locally in your browser.
                  </p>
                </div>
              </Card>
            </div>

            <Card className="border-border/60 bg-card/60 p-6 backdrop-blur md:p-8">
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Layers className="h-4 w-4 text-primary" /> Bulk scan
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Upload many QR images at once. Get a ZIP with CSV + text exports.
                    </p>
                  </div>
                  <Button
                    onClick={() => bulkScanInputRef.current?.click()}
                    disabled={bulkScanBusy}
                    className="h-11 gap-2"
                  >
                    {bulkScanBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {bulkScanBusy ? `Scanning ${bulkScanProgress}%` : "Choose images"}
                  </Button>
                  <input
                    ref={bulkScanInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleBulkScan(e.target.files)}
                  />
                </div>

                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleBulkScan(e.dataTransfer.files);
                  }}
                  onClick={() => !bulkScanBusy && bulkScanInputRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-background/40 p-8 text-center transition-colors hover:border-primary/60 hover:bg-background/60"
                >
                  <Layers className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop multiple QR images here</p>
                  <p className="text-xs text-muted-foreground">Up to 500 files · PNG, JPEG, WEBP</p>
                </div>

                {bulkScanBusy && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-primary transition-all" style={{ width: `${bulkScanProgress}%` }} />
                  </div>
                )}

                {bulkScanResults.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {bulkScanResults.filter((r) => r.status === "ok").length}/{bulkScanResults.length} decoded
                      </span>
                      <span>ZIP downloaded</span>
                    </div>
                    <div className="max-h-64 overflow-auto rounded-lg border border-border bg-background/40 divide-y divide-border">
                      {bulkScanResults.map((r, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 text-xs">
                          <span
                            className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
                              r.status === "ok" ? "bg-primary" : "bg-destructive"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-mono truncate">{r.file}</div>
                            <div className={`mt-0.5 break-all ${r.status === "ok" ? "text-foreground" : "text-muted-foreground italic"}`}>
                              {r.status === "ok" ? r.data : "No QR detected"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        <footer className="mt-12 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <QrCode className="h-3.5 w-3.5" />
          Generated entirely in your browser. Nothing is uploaded.
        </footer>
      </div>
    </main>
  );
};

export default Index;
