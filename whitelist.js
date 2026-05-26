// =====================================================
// VIMECO S.A. — Lista de usuarios autorizados
// =====================================================
// CÓMO USAR ESTE ARCHIVO:
//
// AGREGAR un usuario:
//   Añadí una nueva línea al array con el formato:
//   { codigo: "0008", nombre: "Nombre Apellido" }
//   El código debe ser único y de 4 dígitos.
//
// EDITAR un usuario:
//   Modificá directamente el nombre o código en su línea.
//
// ELIMINAR un usuario:
//   Borrá la línea completa del objeto correspondiente.
//
// =====================================================

const USUARIOS = [
  { codigo: "0001", nombre: "Arq. Matías Pes" },
  { codigo: "0002", nombre: "Arq. Gustavo Pes" },
  { codigo: "0003", nombre: "Ing. Marcelo Pes" },
  { codigo: "0004", nombre: "Ing. David Barreto" },
  { codigo: "0005", nombre: "Ing. Stefano Raisino" },
  { codigo: "0006", nombre: "Arq. José Garay" },
  { codigo: "0007", nombre: "Martín Olea" },
  { codigo: "0008", nombre: "Juan Ignacio Aranega" },
  { codigo: "0000", nombre: "Admin" },
];
