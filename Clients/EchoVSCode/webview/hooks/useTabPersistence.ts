/**
 * useTabPersistence — subscribe to session store and persist tab state to host
 * (which writes to vscode.workspaceState). Fires on every change.
 */

import { useEffect } from 'react'
import { useSessionStore } from '../stores'
import { postToHost } from '../vscode'

export function useTabPersistence(): void {
  useEffect(() => {
    const unsub = useSessionStore.subscribe((state) => {
      postToHost({
        type: 'persist-tabs',
        openTabKeys: state.openTabKeys,
        activeTabKey: state.activeSessionKey,
      })
    })
    return unsub
  }, [])
}
