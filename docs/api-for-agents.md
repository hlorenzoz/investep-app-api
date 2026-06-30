# Investep API — Guía para agentes de IA

> Cómo un agente o cliente debe **interactuar** con la API REST de Investep. La **fuente de verdad**
> de los endpoints es el spec OpenAPI en `GET /openapi.json`; esta guía cubre las **convenciones**
> transversales que el spec no explica por sí solo.

## 1. Descubrir la API (empezá por acá)

- **OpenAPI 3.1**: `GET /openapi.json` — lista TODOS los endpoints, parámetros, schemas de
  request/response y códigos de error. Un agente debe **leer este spec** para conocer el contrato;
  no asumas endpoints que no estén ahí.
- UIs para humanos: `GET /reference` (Scalar) y `GET /docs` (Swagger UI), ambas sobre el mismo spec.
- En **production** la documentación está protegida: requiere `Authorization: Bearer <DOCS_TOKEN>`
  (en `development` está abierta).

## 2. Base URLs

| Entorno | Base URL |
|---|---|
| devel (local, Docker/Bun) | `http://localhost:8787` · emulador Android `http://10.0.2.2:8787` |
| staging | proyecto en Cloudflare Workers (`--env staging`) |
| production | proyecto en Cloudflare Workers (`--env production`) |

## 3. Autenticación

La API se apoya en **Supabase Auth (JWT)**. El cliente hace login con Supabase, obtiene el
`access_token` y lo envía en cada petición protegida:

```http
Authorization: Bearer <supabase_access_token>
```

En el spec OpenAPI el esquema figura como `bearerAuth` (HTTP bearer, formato JWT). El backend valida
el token; el cliente **no** habla con la base directo (eso lo hace la API con su service role).

## 4. Formato de error (único y estable)

**Toda** respuesta de error usa el mismo shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Mensaje legible.", "details": [] } }
```

| `code` | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Entrada inválida (incluye `details` con los issues de Zod) |
| `UNAUTHORIZED` | 401 | Falta o es inválido el token |
| `FORBIDDEN` | 403 | Sin permiso sobre el recurso |
| `NOT_FOUND` | 404 | Recurso inexistente |
| `CONFLICT` | 409 | Conflicto de estado (duplicado, etc.) |
| `INTERNAL_ERROR` | 500 | Error inesperado (sin filtrar internals) |
| `SERVICE_UNAVAILABLE` | 503 | Dependencia externa (p. ej. Supabase Auth) no disponible; reintentá |

`details` es opcional. La API **nunca** devuelve stack traces ni datos sensibles.

## 5. Convenciones

- **JSON** en request y response (`Content-Type: application/json`).
- **Validación**: toda entrada se valida con Zod en el borde → entrada inválida = `422` con `details`.
- **i18n**: el contenido multilingüe se pide con `?locale=es|en` (idioma base: `es`).
- **Brokers = SOLO LECTURA**: la API jamás coloca/modifica/cancela órdenes ni mueve fondos.

## 6. Endpoints disponibles hoy

A continuación se detallan los endpoints activos de la API, agrupados por su dominio de negocio. Cada uno especifica su firma, estructura de entrada (payload JSON, path/query params), formato de éxito y sus códigos de error específicos.

---

### 6.1. Salud y Diagnóstico (`/health`)

#### `GET /health`
- **Autenticación**: Ninguna.
- **Descripción**: Endpoint de prueba de vida (liveness check) para balanceadores y monitoreo básico.
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "status": "ok",
    "service": "investep-app-api",
    "timestamp": "2026-06-30T14:40:00.000Z"
  }
  ```

#### `GET /health/ready`
- **Autenticación**: Ninguna.
- **Descripción**: Lógica de verificación de preparación (readiness check). Comprueba la conectividad real con dependencias críticas (como Supabase/PostgREST).
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "status": "ready",
    "checks": {
      "supabase": "up"
    }
  }
  ```
- **Respuestas de Error**:
  - `503 Service Unavailable` (`SERVICE_UNAVAILABLE`): Si alguna de las dependencias está caída o no responde en tiempo.

---

### 6.2. Autenticación e Identidad (`/auth`)

#### `GET /auth/me`
- **Autenticación**: Obligatoria (`Authorization: Bearer <token>`).
- **Descripción**: Obtiene la información del usuario autenticado a partir del JWT validado contra Supabase Auth. Utilizado por el cliente Flutter para validar la sesión y conocer las atribuciones de rol del usuario.
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "user": {
      "id": "d3b07384-d113-4c3e-a34f-01123456789a",
      "email": "usuario@investepacademy.com",
      "mustResetPassword": false,
      "role": "user"
    }
  }
  ```
- **Respuestas de Error**:
  - `401 Unauthorized` (`UNAUTHORIZED`): Token faltante, expirado o con firma inválida.
  - `503 Service Unavailable` (`SERVICE_UNAVAILABLE`): Supabase Auth experimenta un outage temporal.

#### `POST /auth/change-password`
- **Autenticación**: Obligatoria (`Authorization: Bearer <token>`).
- **Descripción**: Actualiza de forma segura la contraseña del usuario logueado en Supabase Auth y apaga el flag `mustResetPassword`. Dispara una revocación global de sesiones (el usuario actual deberá volver a autenticarse).
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "newPassword": "Password123!"
  }
  ```
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "user": {
      "id": "d3b07384-d113-4c3e-a34f-01123456789a",
      "email": "usuario@investepacademy.com",
      "mustResetPassword": false,
      "role": "user"
    }
  }
  ```
- **Respuestas de Error**:
  - `400 Bad Request` (`VALIDATION_ERROR`): Si la contraseña provista es débil o es igual a la actual.
  - `401 Unauthorized` (`UNAUTHORIZED`): Token faltante o expirado.
  - `422 Unprocessable Entity` (`VALIDATION_ERROR`): Payload JSON mal formado o campos inválidos.
  - `503 Service Unavailable` (`SERVICE_UNAVAILABLE`): Fallo de conexión o caída en los servicios de Supabase.

---

### 6.3. Gestión de Capital (`/capital`)

#### `GET /capital`
- **Autenticación**: Obligatoria (`Authorization: Bearer <token>`).
- **Descripción**: Retorna la vista consolidada de la cartera de capital del usuario. Incluye el capital general, las asignaciones a brokers y el cálculo dinámico del saldo libre y total asignado.
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "capital": 10000.00,
    "allocations": [
      {
        "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
        "brokerCode": "tastytrade",
        "brokerName": "Tastytrade",
        "amount": 4500.00,
        "currency": "USD"
      }
    ],
    "totalAllocated": 4500.00,
    "available": 5500.00
  }
  ```
- **Respuestas de Error**:
  - `401 Unauthorized` (`UNAUTHORIZED`): Sesión inválida.
  - `503 Service Unavailable` (`SERVICE_UNAVAILABLE`): Error temporal de conexión a la base de datos.

#### `PUT /capital`
- **Autenticación**: Obligatoria (`Authorization: Bearer <token>`).
- **Descripción**: Define o reajusta el capital total del usuario en el sistema.
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "capital": 15000.50
  }
  ```
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "capital": 15000.50
  }
  ```
- **Respuestas de Error**:
  - `422 Unprocessable Entity` (`VALIDATION_ERROR`): Si `capital` es menor a cero o posee un formato de número inválido.

#### `POST /capital/allocations`
- **Autenticación**: Obligatoria (`Authorization: Bearer <token>`).
- **Descripción**: Crea una nueva asignación de capital a un broker específico. Inicializa el capital total en 0 si el usuario no tenía un registro previo.
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "brokerCode": "ibkr",
    "amount": 3000.00,
    "currency": "USD"
  }
  ```
- **Respuesta de Éxito (201 Created)**: Retorna la asignación creada y su ID autogenerado.
- **Respuestas de Error**:
  - `409 Conflict` (`CONFLICT`): Si ya existe una asignación para el mismo broker en esta cuenta.
  - `422 Unprocessable Entity` (`VALIDATION_ERROR`): Si el monto es negativo, el broker no existe o la moneda no está soportada.

#### `PATCH /capital/allocations/{id}`
- **Autenticación**: Obligatoria (`Authorization: Bearer <token>`).
- **Descripción**: Actualiza el monto, depósito acumulado o moneda asignados a un broker.
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "amount": 3500.00
  }
  ```
- **Respuesta de Éxito (200 OK)**: Retorna la asignación con los campos modificados.
- **Respuestas de Error**:
  - `404 Not Found` (`NOT_FOUND`): Asignación inexistente o no pertenece al usuario.
  - `422 Unprocessable Entity` (`VALIDATION_ERROR`): Monto inválido.

#### `DELETE /capital/allocations/{id}`
- **Autenticación**: Obligatoria (`Authorization: Bearer <token>`).
- **Descripción**: Elimina una asignación a un broker, liberando su monto de vuelta al capital disponible general.
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "success": true
  }
  ```

#### `POST /capital/transfers`
- **Autenticación**: Obligatoria (`Authorization: Bearer <token>`).
- **Descripción**: Registra una transferencia manual de fondos. Permite mover capital entre brokers (allocation a allocation) o desde/hacia el saldo de capital libre general.
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "fromAllocationId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", // o la palabra "capital"
    "toAllocationId": "capital", // o un UUID de destino
    "amount": 500.00
  }
  ```
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "success": true
  }
  ```
- **Respuestas de Error**:
  - `422 Unprocessable Entity` (`VALIDATION_ERROR`): Monto negativo, IDs malformados, o saldo insuficiente en el origen de la transferencia.

---

### 6.4. Administración de Usuarios y Roles (`/admin/users`)

Todos estos endpoints exigen que el usuario autenticado posea el rol de `"admin"`. Los managers o usuarios corrientes recibirán un error `403 Forbidden`.

#### `GET /admin/users`
- **Descripción**: Retorna la lista total de usuarios registrados en el sistema, combinando la información de autenticación de Supabase Auth con los datos de sus perfiles locales (`public.profiles`).
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "users": [
      {
        "id": "d3b07384-d113-4c3e-a34f-01123456789b",
        "email": "admin@investepacademy.com",
        "role": "admin",
        "fullName": "Administrador General",
        "createdAt": "2026-06-20T10:00:00.000Z",
        "mustResetPassword": false
      }
    ]
  }
  ```

#### `GET /admin/users/{id}`
- **Descripción**: Retorna la información a detalle de un usuario determinado.
- **Respuesta de Éxito (200 OK)**: Retorna el objeto `user` con la misma estructura descrita en el listado.
- **Respuestas de Error**:
  - `404 Not Found` (`NOT_FOUND`): El UUID provisto no coincide con ningún usuario activo.

#### `POST /admin/users`
- **Descripción**: Aprovisiona un usuario nuevo en Supabase Auth, asigna su rol administrativo inicial (`admin`, `manager` o `user`), inicializa su perfil en la DB y gatilla el envío por email de su contraseña temporaria (o la especificada).
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "email": "gerente@investepacademy.com",
    "fullName": "Gerente Operativo",
    "role": "manager",
    "password": "OpcionalPasswordDefinidaPorAdmin"
  }
  ```
- **Respuesta de Éxito (201 Created)**: Retorna la entidad del usuario recién aprovisionado.
- **Respuestas de Error**:
  - `400 Bad Request` (`VALIDATION_ERROR`): Si el email ingresado ya está registrado.
  - `422 Unprocessable Entity` (`VALIDATION_ERROR`): Parámetros ausentes o tipo de rol no soportado.

#### `PATCH /admin/users/{id}`
- **Descripción**: Modifica campos específicos de un usuario (email, rol, contraseña de reset y/o nombre de perfil).
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "fullName": "Gerente Operativo Modificado",
    "role": "admin"
  }
  ```
- **Respuesta de Éxito (200 OK)**: Retorna el usuario actualizado.
- **Respuestas de Error**:
  - `400 Bad Request` (`VALIDATION_ERROR`): Contraseña muy débil en caso de actualización de contraseña.
  - `404 Not Found` (`NOT_FOUND`): Usuario inexistente.

#### `DELETE /admin/users/{id}`
- **Descripción**: Elimina por completo al usuario de la plataforma (Supabase Auth). Dispara un borrado en cascada en la base de datos de perfiles y carteras.
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "success": true
  }
  ```

---

### 6.5. Administración de Planes y Características de la Academia (`/admin/academy`)

Toda acción de escritura o modificación sobre el catálogo de la academia requiere autenticación con el rol de `"admin"`.

#### `GET /admin/academy/plans`
- **Descripción**: Lista todos los planes de suscripción de la academia configurados, con sus traducciones multilenguaje y características asociadas.
- **Respuesta de Éxito (200 OK)**:
  ```json
  {
    "plans": [
      {
        "id": 1,
        "code": "pro-monthly",
        "priceRegular": 49.99,
        "priceOffer": 39.99,
        "url": "https://investepacademy.com/pro",
        "sortOrder": 1,
        "translations": {
          "es": { "name": "Plan Pro Mensual", "description": "Acceso total" },
          "en": { "name": "Pro Monthly Plan", "description": "Full access" }
        },
        "features": [
          { "id": 5, "slug": "live-sessions" }
        ]
      }
    ]
  }
  ```

#### `POST /admin/academy/plans`
- **Descripción**: Crea un nuevo plan de suscripción junto con sus traducciones obligatorias y enlaces a características (`featureIds`).
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "code": "vip-annual",
    "priceRegular": 499.99,
    "priceOffer": 399.99,
    "url": "https://investepacademy.com/vip",
    "sortOrder": 2,
    "featureIds": [1, 2, 5],
    "translations": [
      { "locale": "es", "name": "Plan VIP Anual", "description": "Mentoría 1 a 1" },
      { "locale": "en", "name": "VIP Annual Plan", "description": "1 to 1 Mentorship" }
    ]
  }
  ```
- **Respuesta de Éxito (201 Created)**: Retorna el plan creado e indexado.
- **Respuestas de Error**:
  - `409 Conflict` (`CONFLICT`): Si el código (`code`) del plan ya existe.
  - `422 Unprocessable Entity` (`VALIDATION_ERROR`): Si los precios exceden el rango (`numeric(10,2)`), la url es inválida, se omiten traducciones obligatorias o se repiten `locale`s.

#### `PATCH /admin/academy/plans/{id}`
- **Descripción**: Actualiza de forma atómica e incremental las propiedades de un plan de suscripción. Permite redefinir el set de features (`featureIds`) y las traducciones (se hace reemplazo completo sobre las traducciones provistas).
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "priceOffer": 349.99,
    "featureIds": [1, 5]
  }
  ```
- **Respuesta de Éxito (200 OK)**: Retorna el plan con las modificaciones consolidadas.

#### `DELETE /admin/academy/plans/{id}`
- **Descripción**: Elimina un plan.
- **Respuestas de Error**:
  - `409 Conflict` (`CONFLICT`): Si el plan está actualmente referenciado por suscripciones activas de usuarios (violación de Foreign Key).

#### `GET /admin/academy/features`
- **Descripción**: Obtiene el catálogo completo de características que pueden vincularse a los planes de la academia.

#### `POST /admin/academy/features`
- **Descripción**: Registra una nueva característica en el catálogo.
- **Cuerpo del Request (JSON)**:
  ```json
  {
    "slug": "real-time-chat",
    "sortOrder": 10,
    "translations": [
      { "locale": "es", "name": "Chat en Tiempo Real" },
      { "locale": "en", "name": "Real-time Chat" }
    ]
  }
  ```
- **Respuesta de Éxito (201 Created)**: Retorna la característica creada.
- **Respuestas de Error**:
  - `409 Conflict` (`CONFLICT`): Si el `slug` de la característica ya existe.

#### `PATCH /admin/academy/features/{id}`
- **Descripción**: Edita el `sortOrder`, `slug` y/o reemplaza el listado de traducciones de una característica existente.

#### `DELETE /admin/academy/features/{id}`
- **Descripción**: Remueve una característica del catálogo.
- **Respuestas de Error**:
  - `409 Conflict` (`CONFLICT`): Si la característica se encuentra asociada a algún plan activo.

---


## 7. Reglas del proyecto

El comportamiento, la arquitectura y las políticas de seguridad están en
[`AGENTS.md`](../AGENTS.md). Un agente que **modifique** este repo debe leerlo entero (tipado
estricto, tests por implementación, observabilidad, fintech).
