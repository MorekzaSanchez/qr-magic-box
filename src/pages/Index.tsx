import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Download, QrCode, Sparkles } from "lucide-react";

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

        <footer className="mt-12 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <QrCode className="h-3.5 w-3.5" />
          Generated entirely in your browser. Nothing is uploaded.
        </footer>
      </div>
    </main>
  );
};

export default Index;
