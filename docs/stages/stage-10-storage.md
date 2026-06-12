# ЭТАП 10: Хранилище файлов (Storage + Photo Compression)

> Статус: **в разработке**.

---

## 1. Что реализуем

**Суть:** Device photos (приёмка/диагностика) и документы (заказ-наряды, акты, гарантийные карточки) хранятся в Supabase Storage с RLS-политиками, снимаются на мобильном в реальном времени, сжимаются клиентом (canvas, ~1920px), загружаются в приёмке и на этапах ремонта, отображаются галереей в OrderPage.

| Компонент | Что | Файлы |
|---|---|---|
| **Storage buckets** | `device-photos` (public read), `documents` (RLS read) | — |
| **RLS политики** | Admin/Manager видят все, Master видит только свои заказы | — |
| **Photo compression** | Canvas: resize JPEG/PNG до ~1920px ширины, Quality 75% | `src/shared/lib/compressImage.ts` |
| **Upload UI** | Drag-n-drop / file input в NewOrderPage и OrderPage | `src/features/orders/PhotoUploader.tsx`, обновления в NewOrderPage/OrderPage |
| **Gallery** | Просмотр фото по клику (lightbox), удаление (soft delete) | `src/features/orders/PhotoGallery.tsx` |
| **Soft delete** | RLS-политика скрывает удалённые файлы; is_deleted флаг в attachments | миграция 20260609100008 |

---

## 2. Миграция: таблица attachments (уже создана на Этапе 3) и мета-поля

**Новое на Этапе 10:**
- `supabase/migrations/20260609100008_storage_policies.sql` — RLS для Storage buckets, update triggers для мягкого удаления файлов.

**Существующее:**
- Таблица `attachments` (id, order_id, file_path, file_size, content_type, uploaded_by, created_at, is_deleted) уже в 20260609100002_tables.sql.
- Trigger `set_updated_at` уже срабатывает при создании/удалении.

---

## 3. Артефакты

| Файл | Что | Этап |
|---|---|---|
| `supabase/migrations/20260609100008_storage_policies.sql` | RLS для device-photos и documents buckets; trigger для is_deleted | новый |
| `src/shared/lib/compressImage.ts` | Canvas-сжатие JPEG/PNG до 1920px, quality 75% | новый |
| `src/shared/api/storage.ts` | uploadPhoto(file, orderId), deleteAttachment(id), fetchAttachments(orderId) | новый |
| `src/features/orders/PhotoUploader.tsx` | Drag-n-drop + file input, прогресс, ошибки | новый |
| `src/features/orders/PhotoGallery.tsx` | Lightbox с фото, кнопка удаления (RLS запретит master удалять чужие) | новый |
| `src/features/orders/NewOrderPage.tsx` | Добавить PhotoUploader после создания заказа (опционально, может быть и отложено) | обновить |
| `src/features/orders/OrderPage.tsx` | Вставить PhotoGallery в DefectCard и в новую AttachmentsCard | обновить |

---

## 4. Free tier limit

Supabase Cloud Free: **1GB Storage**, ~300 orders × 2–3 фото/заказ × 200–300KB после сжатия ≈ 180–270MB/год.
**Зелёная зона** — без проблем.

---

## 5. Что именно проверим

1. ✓ RLS: Admin видит все фото, Manager видит все, Master видит только свои заказы (фото других скрыты 403).
2. ✓ Compression: Загруженное фото 4MB PNG сжимается до ~200KB JPEG 1920px.
3. ✓ Gallery: Фотографии отображаются в OrderPage, delete доступен только автору / admin.
4. ✓ Soft delete: is_deleted=true скрывает в RLS; фото удаляется из Storage бакета логически.

---

## 6. Риски и открытые вопросы

- **Storage quotas:** 1GB хватает на ~3 года для одного СЦ. Upgrade на Pro (50GB) — $25/месяц.
- **Metadata sync:** Если фото удалится из Storage, row остаётся в attachments (is_deleted=true). Консистентность гарантирована RLS.
- **Drag-n-drop:** Требует js File API; IE не поддерживает. OK для Chrome/Safari/Firefox/Edge.

---

## 7. Что будет на следующем этапе

**Этап 11 — PDF-документы:** Генерация work_act (акт выполненных работ), issue_act (акт приёма-передачи), intake_receipt (квитанция приёмки), warranty_card (гарантийная карточка) via Edge Function с pdf-lib; сохранение снимка заказа в order_documents; обработка Cyrillic шрифтов.

---

## 8. Инструкция по разработке

### Шаг 1. Миграция RLS для Storage
Создать `supabase/migrations/20260609100008_storage_policies.sql` с:
- `create policy device_photos_admin on storage.objects for select using (bucket_id = 'device-photos' and auth.role() = 'admin');`
- `create policy device_photos_manager on storage.objects for select using (bucket_id = 'device-photos' and auth.role() = 'manager');`
- `create policy device_photos_master on storage.objects for select using (bucket_id = 'device-photos' and (select order_id from attachments where file_path = name limit 1) in (select id from orders where master_id = auth.uid()));`
- Аналогично для documents.
- Trigger `update_attachment_soft_delete` на DELETE attachments: UPDATE file_path = ... (логическое удаление).

### Шаг 2. Photo Compression (клиент)
`src/shared/lib/compressImage.ts`:
```ts
export async function compressImage(file: File, maxWidth = 1920): Promise<Blob> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = img.height / img.width;
        canvas.width = Math.min(img.width, maxWidth);
        canvas.height = canvas.width * ratio;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.75);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
```

### Шаг 3. Storage API (supabase-js)
`src/shared/api/storage.ts`:
```ts
export async function uploadPhoto(file: File, orderId: string): Promise<{ path: string; size: number }> {
  const compressed = await compressImage(file);
  const path = `${orderId}/${Date.now()}_${file.name}`;
  await supabase.storage.from('device-photos').upload(path, compressed);
  return { path, size: compressed.size };
}

export async function fetchAttachments(orderId: string) {
  const { data } = await supabase
    .from('attachments')
    .select('*')
    .eq('order_id', orderId)
    .eq('is_deleted', false);
  return data || [];
}

export async function deleteAttachment(id: string) {
  await supabase.from('attachments').update({ is_deleted: true }).eq('id', id);
}
```

### Шаг 4. UI: PhotoUploader + PhotoGallery
- `PhotoUploader.tsx`: Drag-n-drop zone, file input, progress bar, error handling.
- `PhotoGallery.tsx`: Grid фото, click = lightbox, delete button.

### Шаг 5. Интеграция в OrderPage
- Добавить `<PhotoGallery orderId={orderId} />` в DefectCard или новую карточку.
- После создания заказа можно сразу загружать фото.

---

## ✓ Checklist

- [ ] `20260609100008_storage_policies.sql` создана и применена
- [ ] Buckets `device-photos` и `documents` созданы в Supabase Console
- [ ] `compressImage.ts` написана и протестирована
- [ ] `storage.ts` API реализована
- [ ] `PhotoUploader.tsx` готов
- [ ] `PhotoGallery.tsx` готов
- [ ] OrderPage интегрирует галерею
- [ ] RLS тест: Master может видеть только свои фото
- [ ] vite build + tsc — чисто

---

## 9. ⏸️ СТОП

Жду разработки Этапа 10. После успешной интеграции перейдём к Этапу 11 (PDF-документы).
