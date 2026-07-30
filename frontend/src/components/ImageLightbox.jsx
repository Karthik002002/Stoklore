import { Dialog, DialogContent } from '@/components/ui/dialog'

// Full-screen image viewer - a Dialog sized to fit the viewport instead of the usual max-w-sm.
// Keeps an opaque background (not bg-transparent) - Bar Replay's chart screenshots are captured
// off a transparent canvas (see ReplayChart.jsx's chart background option), so without a solid
// backdrop behind it the blurred page underneath shows straight through the image's empty areas.
export default function ImageLightbox({ src, open, onOpenChange }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    >
      <DialogContent className="w-[90vw] !max-w-[100%] border-none bg-background p-2 shadow-none ring-0">
        {src && (
          <img
            src={src}
            alt="Trade screenshot"
            className="max-h-[100%] max-w-[100%] rounded-lg object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
