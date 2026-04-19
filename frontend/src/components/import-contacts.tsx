/**
 * Import Contacts Modal — 批量从 CSV 导入联系人
 *
 * 功能：
 *   - 拖拽或点击上传 CSV 文件
 *   - 导入前显示预览（前 5 行 + 行数）
 *   - 选择是否更新已存在的联系人（默认跳过）
 *   - 导入后显示结果报告：成功/更新/跳过/失败
 *   - 下载空白模板
 */
"use client";

import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { contactsApi } from "@/lib/api";

interface ImportContactsProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ImportResult {
  batch_id: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; email?: string; reason: string }>;
}

export default function ImportContacts({ open, onClose, onSuccess }: ImportContactsProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ header: string[]; rows: string[][]; total: number } | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setImporting(false);
    setUpdateExisting(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  // 简单的 CSV 前端解析（只用于预览前 5 行）
  const parsePreview = useCallback(async (f: File) => {
    const text = await f.text();
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      setError("File is empty");
      return;
    }
    // 简易分割，不处理带引号逗号的特殊情况 —— 预览足够
    const header = lines[0].split(",").map(s => s.trim());
    const rows = lines.slice(1, 6).map(line => line.split(","));
    setPreview({ header, rows, total: lines.length - 1 });
    setError(null);
  }, []);

  const handleFile = useCallback((f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Only .csv files are supported");
      return;
    }
    setFile(f);
    parsePreview(f);
  }, [parsePreview]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer.files?.[0] ?? null);
  }, [handleFile]);

  const handleImport = useCallback(async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const res = await contactsApi.importCsv(file, updateExisting) as ImportResult;
      setResult(res);
      if (res.created > 0 || res.updated > 0) onSuccess?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [file, updateExisting, onSuccess]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Contacts from CSV</DialogTitle>
        </DialogHeader>

        {/* === 结果页 === */}
        {result ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-4 gap-3 text-center">
              <div className="p-3 rounded border border-green-200 bg-green-50">
                <p className="text-2xl font-semibold text-green-700">{result.created}</p>
                <p className="text-xs text-green-600 mt-1">Created</p>
              </div>
              <div className="p-3 rounded border border-blue-200 bg-blue-50">
                <p className="text-2xl font-semibold text-blue-700">{result.updated}</p>
                <p className="text-xs text-blue-600 mt-1">Updated</p>
              </div>
              <div className="p-3 rounded border border-gray-200 bg-gray-50">
                <p className="text-2xl font-semibold text-gray-700">{result.skipped}</p>
                <p className="text-xs text-gray-600 mt-1">Skipped</p>
              </div>
              <div className="p-3 rounded border border-red-200 bg-red-50">
                <p className="text-2xl font-semibold text-red-700">{result.failed}</p>
                <p className="text-xs text-red-600 mt-1">Failed</p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="border border-red-200 rounded p-3 max-h-48 overflow-y-auto">
                <p className="text-xs font-medium text-red-700 mb-2">Error details (first {result.errors.length}):</p>
                <ul className="space-y-1 text-xs text-red-600">
                  {result.errors.map((err, i) => (
                    <li key={i}>
                      Row {err.row}{err.email ? ` (${err.email})` : ""}: {err.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => reset()}>Import Another</Button>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          // === 上传 / 预览页 ===
          <div className="space-y-4 py-2">
            {!file ? (
              <div
                onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
                  dragActive ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <p className="text-sm text-gray-600">
                  Drag a CSV file here, or <span className="text-blue-600 underline">click to select a file</span>
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  UTF-8 / GBK encoding supported · Required fields: first_name, last_name, email
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded border">
                  <div className="text-sm">
                    <p className="font-medium text-gray-800">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024).toFixed(1)} KB
                      {preview && ` · ${preview.total} rows`}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={reset}>×</Button>
                </div>

                {preview && (
                  <div className="border rounded overflow-x-auto max-h-56">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {preview.header.map((h, i) => (
                            <th key={i} className="px-2 py-1.5 text-left font-medium text-gray-600 border-b whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((row, i) => (
                          <tr key={i} className="border-b">
                            {row.map((cell, j) => (
                              <td key={j} className="px-2 py-1 text-gray-700 whitespace-nowrap truncate max-w-[180px]">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-gray-400 p-2 bg-gray-50">
                      Showing first {preview.rows.length} rows · {preview.total} total
                    </p>
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  If the email already exists, <b className="ml-1">update</b> with CSV data (otherwise skip)
                </label>
              </div>
            )}

            {error && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {error}
              </div>
            )}

            <DialogFooter className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => contactsApi.downloadTemplate()}
              >
                ↓ Download Template
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>Cancel</Button>
                <Button onClick={handleImport} disabled={!file || importing}>
                  {importing ? "Importing..." : "Import"}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
