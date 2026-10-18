import { useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Download,
  FileSpreadsheet,
  PackageSearch,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { EmptyState } from '@/components/foundation/EmptyState';
import { LoadingState } from '@/components/foundation/LoadingState';
import { StatusChip } from '@/components/foundation/StatusChip';
import { useOrg } from '@/hooks/useOrg';
import { useProducts } from '@/hooks/useProducts';
import { exportFileName } from '@/lib/brand';
import { textKey } from '@/lib/contact-import';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { downloadText, MAX_CSV_BYTES } from '@/lib/csv';
import { DEAL_ITEM_BILLING_LABELS, PRODUCT_KIND_LABELS } from '@/lib/deal-logic';
import type { CatalogProduct } from '@/lib/deal-types';
import { formatBRL } from '@/lib/money';
import { productTemplateCsv } from '@/lib/product-import-headers';
import {
  analyzeProductImport,
  readProductSheet,
  type ProductImportAnalysis,
  type ProductSheet,
} from '@/lib/product-import';
import { SHEET_MESSAGES } from '@/lib/sheet-import';
import { CatalogImportDialog } from './CatalogImportDialog';
import {
  CATALOG_MESSAGES,
  catalogErrorMessage,
  createProduct,
  deleteProduct,
  setProductArchived,
  updateProduct,
  type ProductFields,
} from './data';
import { ProductDialog } from './ProductDialog';

type Filter = 'active' | 'archived' | 'all';
const FILTERS: [Filter, string][] = [
  ['active', 'Ativos'],
  ['archived', 'Arquivados'],
  ['all', 'Todos'],
];
const selectClass = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm sm:w-44';
const IMPORT_ACCEPT = '.csv,.txt,.xlsx,.xls,.ods,text/csv,text/plain';

/**
 * A aba "Catálogo" de Configurações (item 1.16; docs/arquitetura/1.16.md, seção 7.1): a lista com busca por nome ou
 * código e o filtro "Ativos", "Arquivados" e "Todos"; no desktop, uma linha por item com as colunas, e no celular, um
 * cartão. Donos e administradores criam, editam, arquivam, reativam, excluem (só o que nunca foi usado), importam por
 * planilha e baixam o modelo; os demais consultam, com o aviso. Num banco sem a migração, a mensagem de atualização.
 */
export function CatalogSettings({ canManage }: { canManage: boolean }) {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const catalog = useProducts();
  const searchId = useId();
  const filterId = useId();
  const fileHelpId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<CatalogProduct | 'new' | null>(null);
  const [removing, setRemoving] = useState<CatalogProduct | null>(null);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState<{
    key: number;
    sheet: ProductSheet;
    analysis: ProductImportAnalysis;
  } | null>(null);
  const refresh = () => invalidateCrmTables(queryClient, ['products']);
  const products = catalog.products;
  const key = textKey(search);
  const visible = products.filter(
    (product) =>
      (filter === 'all' || (filter === 'archived' ? !!product.archived_at : !product.archived_at)) &&
      (!key || textKey(product.name).includes(key) || (!!product.code && textKey(product.code).includes(key))),
  );

  const save = async (fields: ProductFields) => {
    if (!orgId) return;
    try {
      if (editing && editing !== 'new') await updateProduct(orgId, editing, fields);
      else await createProduct(orgId, fields);
    } catch (cause) {
      // O conflito de versão recarrega a lista; o preenchimento continua no diálogo.
      if (cause instanceof Error && cause.message === CATALOG_MESSAGES.conflict) void refresh();
      throw new Error(catalogErrorMessage(cause, fields.code));
    }
    await refresh();
    toast.success(editing && editing !== 'new' ? 'Item do catálogo atualizado.' : 'Item criado no catálogo.');
  };
  const archive = async (product: CatalogProduct, archived: boolean) => {
    if (!orgId || busyId) return;
    setBusyId(product.id);
    setError('');
    try {
      await setProductArchived(orgId, product, archived);
      toast.success(archived ? 'Item arquivado. Ele sai das escolhas dos itens novos.' : 'Item reativado.');
    } catch (cause) {
      setError(catalogErrorMessage(cause));
    } finally {
      setBusyId('');
      await refresh();
    }
  };
  const remove = async () => {
    if (!orgId || !removing) return;
    setBusyId(removing.id);
    setError('');
    try {
      await deleteProduct(orgId, removing.id);
      toast.success('Item excluído do catálogo.');
    } catch (cause) {
      setError(catalogErrorMessage(cause));
    } finally {
      setBusyId('');
      setRemoving(null);
      await refresh();
    }
  };
  const readFile = async (file: File) => {
    setError('');
    if (file.size > MAX_CSV_BYTES) {
      setError(SHEET_MESSAGES.tooLarge);
      return;
    }
    setReading(true);
    try {
      const read = readProductSheet(new Uint8Array(await file.arrayBuffer()), file.name);
      if (read.error !== null) {
        setError(read.error);
        return;
      }
      // A prévia confere as repetidas contra o catálogo atual, relido agora.
      const current = await catalog.refetch();
      if (current.error) throw current.error;
      setImporting({
        key: Date.now(),
        sheet: read.sheet,
        analysis: analyzeProductImport(read.sheet, current.data ?? []),
      });
    } catch (cause) {
      setError(catalogErrorMessage(cause));
    } finally {
      setReading(false);
    }
  };

  if (catalog.missing)
    return (
      <p role="status" className="rounded-xl bg-muted p-4 text-sm">
        {CATALOG_MESSAGES.missing}
      </p>
    );
  return (
    <section className="space-y-5" data-catalog-settings>
      <p className="text-sm text-muted-foreground">
        Os produtos e serviços que a empresa vende, com o preço e a cobrança (única ou mensal). Nas oportunidades, os
        itens escolhidos do catálogo formam o valor do contrato; o preço pode ser negociado em cada oportunidade.
      </p>
      {canManage && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button className="eia-touch-target" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden />
              Novo item
            </Button>
            <Button
              variant="outline"
              className="eia-touch-target"
              disabled={reading}
              aria-describedby={fileHelpId}
              onClick={() => fileInput.current?.click()}
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              {reading ? 'Lendo planilha…' : 'Importar planilha'}
            </Button>
            <Button
              variant="ghost"
              className="eia-touch-target"
              onClick={() => downloadText(exportFileName('modelo-catalogo', 'csv'), productTemplateCsv())}
            >
              <Download className="h-4 w-4" aria-hidden />
              Baixar modelo
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={IMPORT_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label="Planilha do catálogo (CSV)"
              data-catalog-file
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.target.value = '';
              }}
            />
          </div>
          <p id={fileHelpId} className="text-xs text-muted-foreground">
            Planilha CSV com as colunas nome e preço (e, se quiser, código, tipo, unidade e cobrança), até 5.000 linhas.
            No Excel, use Arquivo &gt; Salvar como e escolha “CSV UTF-8 (delimitado por vírgulas)”. Itens que já existem
            no catálogo ficam de fora.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-destructive p-4 text-sm">
          {error}
        </p>
      )}
      {catalog.isPending ? (
        <LoadingState label="Carregando catálogo…" />
      ) : catalog.isError ? (
        <div role="alert" className="space-y-2">
          <p>{catalogErrorMessage(catalog.error)}</p>
          <Button onClick={() => void catalog.refetch()}>Tentar novamente</Button>
        </div>
      ) : !products.length ? (
        <EmptyState
          icon={PackageSearch}
          title="Nenhum item no catálogo."
          description={
            canManage
              ? 'Cadastre os produtos e serviços que a empresa vende para montar oportunidades com itens, quantidades e descontos. O catálogo é opcional: oportunidades sem itens continuam com o valor digitado.'
              : 'Peça a um dono ou administrador para cadastrar os produtos e serviços.'
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor={searchId} className="text-sm font-medium">
                Buscar no catálogo
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id={searchId}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nome ou código"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor={filterId} className="text-sm font-medium">
                Situação
              </label>
              <select
                id={filterId}
                className={selectClass}
                value={filter}
                onChange={(event) => setFilter(event.target.value as Filter)}
              >
                {FILTERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {visible.length === 1 ? '1 item' : `${visible.length.toLocaleString('pt-BR')} itens`}
          </p>
          {visible.length ? (
            <div className="rounded-2xl border border-border">
              <div
                aria-hidden
                className="hidden gap-3 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_auto]"
              >
                <span>Nome</span>
                <span>Tipo e unidade</span>
                <span>Preço</span>
                <span>Situação</span>
                <span className="w-[8.5rem] text-right">Ações</span>
              </div>
              <ul aria-label="Itens do catálogo" className="divide-y divide-border">
                {visible.map((product) => (
                  <li
                    key={product.id}
                    className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_auto] md:items-center md:gap-3"
                    data-catalog-item
                  >
                    <div className="min-w-0">
                      <p className="font-medium [overflow-wrap:anywhere]">{product.name}</p>
                      {product.code && (
                        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Código {product.code}</p>
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      {PRODUCT_KIND_LABELS[product.kind]}
                      {product.unit ? ` · ${product.unit}` : ''}
                    </p>
                    <p className="tabular-nums">
                      {formatBRL(Number(product.price))}
                      {product.billing === 'monthly' ? '/mês' : ''}
                      <span className="block text-xs text-muted-foreground">
                        Cobrança {DEAL_ITEM_BILLING_LABELS[product.billing].toLowerCase()}
                      </span>
                    </p>
                    <div>
                      <StatusChip tone={product.archived_at ? 'neutral' : 'success'}>
                        {product.archived_at ? 'Arquivado' : 'Ativo'}
                      </StatusChip>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-1 md:w-[8.5rem] md:justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="eia-touch-target"
                          aria-label={`Editar ${product.name}`}
                          disabled={!!busyId}
                          onClick={() => setEditing(product)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="eia-touch-target"
                          aria-label={`${product.archived_at ? 'Reativar' : 'Arquivar'} ${product.name}`}
                          disabled={!!busyId}
                          onClick={() => void archive(product, !product.archived_at)}
                        >
                          {product.archived_at ? (
                            <ArchiveRestore className="h-4 w-4" aria-hidden />
                          ) : (
                            <Archive className="h-4 w-4" aria-hidden />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="eia-touch-target text-destructive"
                          aria-label={`Excluir ${product.name}`}
                          disabled={!!busyId}
                          onClick={() => setRemoving(product)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    ) : (
                      <span className="hidden md:block md:w-[8.5rem]" />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum item com essa busca e essa situação.</p>
          )}
        </>
      )}
      {editing && (
        <ProductDialog
          key={editing === 'new' ? 'new' : editing.id}
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Excluir item do catálogo?"
        description={`“${removing?.name ?? ''}” sai do catálogo. Um item já usado em oportunidades não pode ser excluído: arquive para tirá-lo das escolhas.`}
        confirmLabel="Excluir item"
        loading={!!busyId}
        onConfirm={remove}
      />
      {importing && orgId && (
        <CatalogImportDialog
          key={importing.key}
          orgId={orgId}
          sheet={importing.sheet}
          analysis={importing.analysis}
          onClose={() => setImporting(null)}
        />
      )}
    </section>
  );
}
