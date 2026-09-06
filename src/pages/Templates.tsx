import { FileText } from "lucide-react";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { EmptyState } from "@/components/foundation/EmptyState";

export default function Templates() {
  return (
    <PageScaffold title="Templates">
      <EmptyState
        icon={FileText}
        title="Em breve"
        description="Estamos preparando a biblioteca de templates para mensagens de WhatsApp, confirmações de consulta e prontuários padronizados."
      />
    </PageScaffold>
  );
}
