import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/state/store'
import { getShowGuideOnStartup, setShowGuideOnStartup } from '@/components/Guide/UserGuideModal'

// Deliberately minimal — the feature spec listed "Settings" as a Home Screen entry point
// without enumerating what belongs in it, and the app doesn't have a broader app-level
// preferences system yet. This wires up the one preference that already existed (show the
// User Guide on startup, previously only togglable from inside the guide itself) rather than
// shipping a dead button; more settings can be added here later without changing how it's
// opened.
export function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const [showOnStartup, setShowOnStartupState] = useState(getShowGuideOnStartup)

  if (!open) return null

  const toggle = () => {
    const next = !showOnStartup
    setShowOnStartupState(next)
    setShowGuideOnStartup(next)
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
        onClick={() => setOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.15 }}
          className="studio-panel w-[420px] max-w-[90vw] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-studio-border">
            <h2 className="text-sm font-semibold">Settings</h2>
            <button className="studio-btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm">Show User Guide on startup</span>
              <input type="checkbox" checked={showOnStartup} onChange={toggle} />
            </label>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
