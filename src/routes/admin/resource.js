const express = require('express');
const db = require('../../db');
const { upload, saveFile } = require('../../lib/media');
const { slugify, parseJson } = require('../../lib/format');
const { flash } = require('../../middleware/locals');

/**
 * Tạo bộ route CRUD cho một bảng từ mô tả field.
 *
 * Field types: text, textarea, markdown, number, money, checkbox, select, image, gallery, date, slug
 */
function resource(def) {
  const router = express.Router();
  const base = `/admin/${def.path}`;
  const perPage = 25;

  function blank() {
    const o = {};
    for (const f of def.fields) o[f.name] = f.default ?? (f.type === 'checkbox' ? false : '');
    return o;
  }

  async function options() {
    const out = {};
    for (const f of def.fields) {
      if (f.type === 'select') out[f.name] = typeof f.options === 'function' ? await f.options() : f.options;
    }
    return out;
  }

  async function renderForm(res, item, errors = {}, status = 200) {
    res.status(status);
    res.render('admin/resource-form', {
      def, base, item, errors, opts: await options(),
      title: item.id ? `Sửa ${def.singular}` : `Thêm ${def.singular}`,
      viewUrl: item.id && def.viewUrl ? def.viewUrl(item) : null,
    });
  }

  async function uniqueSlug(value, id) {
    const root = slugify(value) || `${def.path}-${Date.now()}`;
    let slug = root;
    for (let i = 2; ; i++) {
      const q = db(def.table).where({ slug });
      if (id) q.andWhere('id', '!=', id);
      if (!(await q.first())) return slug;
      slug = `${root}-${i}`;
    }
  }

  async function collect(req, existing) {
    const body = req.body || {};
    const files = req.files || [];
    const values = {};
    const errors = {};
    for (const f of def.fields) {
      const raw = body[f.name];
      switch (f.type) {
        case 'checkbox':
          values[f.name] = raw === '1' || raw === 'on';
          break;
        case 'number':
        case 'money': {
          const s = String(raw ?? '').replace(/[.,\s₫]/g, '');
          if (s === '') {
            values[f.name] = null;
            if (f.required) errors[f.name] = `Vui lòng nhập ${f.label.toLowerCase()}.`;
          } else if (!/^-?\d+$/.test(s)) {
            errors[f.name] = `${f.label} phải là số.`;
            values[f.name] = raw;
          } else values[f.name] = Number(s);
          break;
        }
        case 'select':
          values[f.name] = raw === '' || raw == null ? null : f.numeric ? Number(raw) : String(raw);
          if (f.required && values[f.name] == null) errors[f.name] = `Vui lòng chọn ${f.label.toLowerCase()}.`;
          break;
        case 'image': {
          const file = files.find((x) => x.fieldname === f.name);
          if (file) values[f.name] = await saveFile(file, body.name || body.title);
          else if (body[`${f.name}_remove`]) values[f.name] = null;
          else values[f.name] = existing ? existing[f.name] : null;
          break;
        }
        case 'gallery': {
          const remove = new Set([].concat(body[`${f.name}_remove`] || []).map(Number));
          const keep = parseJson(existing && existing[f.name], []).filter((id) => !remove.has(id));
          for (const file of files.filter((x) => x.fieldname === f.name)) keep.push(await saveFile(file, body.name));
          values[f.name] = JSON.stringify(keep);
          break;
        }
        case 'date': {
          const v = String(raw || '').trim();
          values[f.name] = v || null;
          if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[f.name] = 'Ngày không hợp lệ.';
          break;
        }
        default: {
          const v = String(raw ?? '').trim().slice(0, f.max || (f.type === 'text' || f.type === 'slug' ? 255 : 100000));
          values[f.name] = v === '' ? null : v;
          if (f.required && !v) errors[f.name] = `Vui lòng nhập ${f.label.toLowerCase()}.`;
        }
      }
    }
    const slugField = def.fields.find((f) => f.type === 'slug');
    if (slugField && !errors[def.titleField]) {
      values.slug = await uniqueSlug(values.slug || values[def.titleField], existing && existing.id);
    }
    if (def.validate) Object.assign(errors, await def.validate(values, existing));
    if (def.transform) await def.transform(values, existing);
    return { values, errors };
  }

  router.get(`/${def.path}`, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const page = Math.max(1, Number(req.query.trang) || 1);
    let query = db(def.table);
    if (q && def.searchable) {
      query = query.where((w) => {
        for (const col of def.searchable) w.orWhere(col, 'like', `%${q}%`);
      });
    }
    const [{ n }] = await query.clone().count({ n: '*' });
    const rows = await query
      .orderBy(def.orderBy || [{ column: 'id', order: 'desc' }])
      .limit(perPage)
      .offset((page - 1) * perPage);
    const lookups = def.lookups ? await def.lookups(rows) : {};
    res.render('admin/resource-list', {
      def, base, rows, q, page, pages: Math.max(1, Math.ceil(Number(n) / perPage)), total: Number(n), lookups,
      title: def.title,
    });
  });

  router.get(`/${def.path}/moi`, async (req, res) => renderForm(res, blank()));

  router.post(`/${def.path}/moi`, upload.any(), async (req, res) => {
    const { values, errors } = await collect(req, null);
    if (Object.keys(errors).length) return renderForm(res, values, errors, 422);
    const [id] = await db(def.table).insert(values);
    flash(req, 'success', `Đã thêm ${def.singular}.`);
    res.redirect(`${base}/${typeof id === 'object' ? id.id : id}`);
  });

  router.get(`/${def.path}/:id`, async (req, res, next) => {
    const item = await db(def.table).where({ id: Number(req.params.id) }).first();
    if (!item) return next();
    renderForm(res, item);
  });

  router.post(`/${def.path}/:id`, upload.any(), async (req, res, next) => {
    const existing = await db(def.table).where({ id: Number(req.params.id) }).first();
    if (!existing) return next();
    const { values, errors } = await collect(req, existing);
    if (Object.keys(errors).length) return renderForm(res, { ...existing, ...values }, errors, 422);
    if ('updated_at' in existing) values.updated_at = new Date();
    await db(def.table).where({ id: existing.id }).update(values);
    flash(req, 'success', 'Đã lưu thay đổi.');
    res.redirect(`${base}/${existing.id}`);
  });

  router.post(`/${def.path}/:id/xoa`, async (req, res) => {
    await db(def.table).where({ id: Number(req.params.id) }).del();
    flash(req, 'success', `Đã xóa ${def.singular}.`);
    res.redirect(base);
  });

  return router;
}

module.exports = resource;
