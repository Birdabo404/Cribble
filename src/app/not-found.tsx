import { VoidScreen } from '@/components/system/VoidScreen'

// Global 404 — any uncharted route drops the visitor into the void scene.
export default function NotFound() {
  return <VoidScreen variant="not-found" />
}
