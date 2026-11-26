package httpapi

import (
	"errors"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/lan/meta-gateway/internal/backup"
)

type BackupHandler struct{ service *backup.Service }

func NewBackupHandler(service *backup.Service) *BackupHandler {
	return &BackupHandler{service: service}
}
func (h *BackupHandler) Register(r chi.Router) {
	r.Get("/backups", h.list)
	r.Post("/backups", h.create)
	r.Get("/backups/{name}/download", h.download)
}

func (h *BackupHandler) create(w http.ResponseWriter, r *http.Request) {
	record, err := h.service.Create(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "backup failed")
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (h *BackupHandler) list(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 500 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 500")
			return
		}
		limit = parsed
	}
	records, err := h.service.List(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list backups")
		return
	}
	writeJSON(w, http.StatusOK, records)
}

func (h *BackupHandler) download(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	file, err := h.service.Open(name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.NotFound(w, r)
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to open backup")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read backup")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	http.ServeContent(w, r, name, info.ModTime(), file)
}
