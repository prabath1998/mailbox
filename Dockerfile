FROM node:22-alpine AS ui
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=ui /src/web/dist ./web/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /mailbox . \
 && mkdir /data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /mailbox /mailbox
COPY --from=build --chown=nonroot:nonroot /data /data
ENV MAILBOX_DB=/data/mailbox.db
VOLUME /data
EXPOSE 1025 8025
ENTRYPOINT ["/mailbox"]
