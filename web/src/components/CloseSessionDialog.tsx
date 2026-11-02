import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'

export function CloseSessionDialog(props: {
    isOpen: boolean
    onClose: () => void
    sessionId: string
    sessionName: string
    onConfirm: () => Promise<void>
    isPending: boolean
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    return <ConfirmDialog
        isOpen={props.isOpen} onClose={props.onClose}
        title={t('session.action.close')}
        description={t('dialog.close.description', { name: props.sessionName })}
        confirmLabel={t('session.action.close')} confirmingLabel={t('dialog.close.pending')}
        onConfirm={props.onConfirm} isPending={props.isPending}
        allowDismissWhilePending destructive centerTitle
        onBackgroundError={message => addToast({ title: t('dialog.close.error'), body: message,
            sessionId: props.sessionId, url: `/sessions/${props.sessionId}` })}
    />
}
