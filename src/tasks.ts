/**
 * Every task has its own address, so a link to "compress" opens straight into
 * compressing, and a shared link shows its own preview card. The build writes
 * a page per task with these texts (see vite.config.ts).
 */
export interface Task {
  slug: string
  /** The editor tool it opens, or an export preset for resize / convert. */
  tool: 'adjust' | 'crop' | 'background' | 'retouch' | 'compress'
  action?: 'resize' | 'convert'
  label: string
  heading: string
  title: string
  description: string
}

export const SITE = 'https://mrnednick.github.io/photo-lab/'

export const TASKS: Task[] = [
  {
    slug: 'remove-background',
    tool: 'background',
    label: 'Remove background',
    heading: 'Remove the background',
    title: 'Remove background free — no sign-up · Photo Lab',
    description:
      'Cut out the subject of any photo for free: transparent PNG, a solid colour or a soft blur behind it. No sign-up, nothing uploaded.',
  },
  {
    slug: 'compress',
    tool: 'compress',
    label: 'Compress',
    heading: 'Compress a photo',
    title: 'Compress an image to 100 KB, 500 KB or 1 MB free · Photo Lab',
    description:
      'Shrink a photo to the file size a form or a chat accepts, at the best quality that fits. Free, no sign-up, nothing uploaded.',
  },
  {
    slug: 'resize',
    tool: 'adjust',
    action: 'resize',
    label: 'Resize',
    heading: 'Resize a photo',
    title: 'Resize an image free — no sign-up · Photo Lab',
    description:
      'Make a photo 1080 px for social media, 2048 px, half size or an exact width — one photo or fifty at once. Free, nothing uploaded.',
  },
  {
    slug: 'convert',
    tool: 'adjust',
    action: 'convert',
    label: 'Convert',
    heading: 'Convert a photo',
    title: 'Convert HEIC, PNG and WebP to JPEG free · Photo Lab',
    description:
      'Turn iPhone HEIC, PNG, WebP or AVIF into JPEG, PNG or WebP — one photo or a whole batch. Free, no sign-up, nothing uploaded.',
  },
  {
    slug: 'crop',
    tool: 'crop',
    label: 'Crop',
    heading: 'Crop a photo',
    title: 'Crop a photo for Instagram, Stories and YouTube free · Photo Lab',
    description:
      'Crop to 1:1, 4:5, 9:16, 16:9 or any shape, straighten the horizon and rotate. Free, no sign-up, nothing uploaded.',
  },
  {
    slug: 'blur',
    tool: 'retouch',
    label: 'Blur faces',
    heading: 'Blur faces and plates',
    title: 'Blur a face or number plate in a photo free · Photo Lab',
    description:
      'Hide faces, number plates and addresses with a blur or pixels before you share. Free, no sign-up, nothing uploaded.',
  },
]
